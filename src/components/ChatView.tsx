import {
	Alert,
	Badge,
	Box,
	Button,
	Center,
	Group,
	Loader,
	Paper,
	ScrollArea,
	Stack,
	Text,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useInterval } from "@mantine/hooks";
import { useEffect, useRef, useState } from "react";
import type { Session } from "../api";
import {
	getSessionsById,
	postSessionsByIdAnswer,
	postSessionsByIdEnd,
} from "../api";

// ── Types ─────────────────────────────────────────────────────────────────────

type Message =
	| { id: string; type: "status"; text: string; status: string }
	| { id: string; type: "question"; question: string; context: string }
	| { id: string; type: "answer"; text: string }
	| { id: string; type: "error"; text: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
	idle: "Idle",
	dialing: "Dialing…",
	active: "Call active",
	awaiting_input: "Waiting for your answer",
	ended: "Call ended",
};

const STATUS_COLORS: Record<string, string> = {
	idle: "gray",
	dialing: "blue",
	active: "green",
	awaiting_input: "orange",
	ended: "gray",
};

const uid = () => crypto.randomUUID();

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
	sessionId: string;
}

export function ChatView({ sessionId }: Props) {
	const [session, setSession] = useState<Session | null>(null);
	const [messages, setMessages] = useState<Message[]>([
		{ id: uid(), type: "status", text: "Call started", status: "dialing" },
	]);
	const [submitting, setSubmitting] = useState(false);
	const [endingCall, setEndingCall] = useState(false);
	const lastStatusRef = useRef<string | null>(null);
	const lastQuestionRef = useRef<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const consecutiveErrorsRef = useRef(0);

	const answerForm = useForm({ initialValues: { answer: "" } });

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: "smooth" });
	});

	const polling = useInterval(async () => {
		const { data, error } = await getSessionsById({ path: { id: sessionId } });

		if (error || !data) {
			// 404 means the session is definitively gone (e.g. server restarted).
			const isNotFound =
				typeof error === "object" &&
				error !== null &&
				"error" in error &&
				(error as { error: string }).error === "Not found";

			if (isNotFound) {
				polling.stop();
				setMessages((prev) => [
					...prev,
					{ id: uid(), type: "error", text: "Session not found" },
				]);
				return;
			}

			// Network / server error — stop after 3 consecutive failures.
			consecutiveErrorsRef.current += 1;
			if (consecutiveErrorsRef.current >= 3) {
				polling.stop();
				setMessages((prev) => [
					...prev,
					{ id: uid(), type: "error", text: "Lost connection to server" },
				]);
			}
			return;
		}

		consecutiveErrorsRef.current = 0;

		setSession(data);

		if (data.status !== lastStatusRef.current) {
			lastStatusRef.current = data.status;
			setMessages((prev) => [
				...prev,
				{
					id: uid(),
					type: "status",
					text: STATUS_LABELS[data.status] ?? data.status,
					status: data.status,
				},
			]);
			if (data.status === "ended") polling.stop();
		}

		if (
			data.pendingQuestion &&
			data.pendingQuestion.question !== lastQuestionRef.current
		) {
			const { question, context } = data.pendingQuestion;
			lastQuestionRef.current = question;
			setMessages((prev) => [
				...prev,
				{ id: uid(), type: "question", question, context },
			]);
		}
	}, 2000);

	useEffect(() => {
		polling.start();
		return () => polling.stop();
	}, [polling.start, polling.stop]);

	async function handleAnswer(values: { answer: string }) {
		setSubmitting(true);
		const { error } = await postSessionsByIdAnswer({
			path: { id: sessionId },
			body: { answer: values.answer },
		});
		setSubmitting(false);
		if (error) {
			setMessages((prev) => [
				...prev,
				{
					id: uid(),
					type: "error",
					text:
						(error as { error?: string })?.error ?? "Failed to submit answer",
				},
			]);
			return;
		}
		setMessages((prev) => [
			...prev,
			{ id: uid(), type: "answer", text: values.answer },
		]);
		lastQuestionRef.current = null;
		answerForm.reset();
	}

	async function handleEndCall() {
		setEndingCall(true);
		await postSessionsByIdEnd({ path: { id: sessionId } });
		setEndingCall(false);
	}

	const isEnded = session?.status === "ended";
	const hasPendingQuestion = !!session?.pendingQuestion;

	return (
		<Stack h="100%" gap="md">
			<Group justify="space-between">
				<Title order={3}>Voice AI</Title>
				<Group gap="sm">
					{session && (
						<Badge color={STATUS_COLORS[session.status] ?? "gray"}>
							{STATUS_LABELS[session.status] ?? session.status}
						</Badge>
					)}
					{!isEnded && session && (
						<Button
							size="xs"
							color="red"
							variant="outline"
							loading={endingCall}
							onClick={handleEndCall}
						>
							End call
						</Button>
					)}
				</Group>
			</Group>

			<ScrollArea flex={1} type="auto">
				<Stack gap="xs" pr="xs">
					{messages.map((msg) => {
						if (msg.type === "status") {
							return (
								<Center key={msg.id}>
									<Badge
										variant="outline"
										color={STATUS_COLORS[msg.status] ?? "gray"}
									>
										{msg.text}
									</Badge>
								</Center>
							);
						}
						if (msg.type === "question") {
							return (
								<Paper key={msg.id} p="sm" withBorder radius="md" maw="80%">
									<Stack gap={4}>
										<Text size="xs" c="dimmed">
											{msg.context}
										</Text>
										<Text size="sm">{msg.question}</Text>
									</Stack>
								</Paper>
							);
						}
						if (msg.type === "answer") {
							return (
								<Box
									key={msg.id}
									style={{ display: "flex", justifyContent: "flex-end" }}
								>
									<Paper p="sm" bg="blue" radius="md" maw="80%">
										<Text size="sm" c="white">
											{msg.text}
										</Text>
									</Paper>
								</Box>
							);
						}
						return (
							<Alert key={msg.id} color="red" variant="light">
								{msg.text}
							</Alert>
						);
					})}

					{!isEnded && !hasPendingQuestion && session?.status === "active" && (
						<Group gap="xs">
							<Loader size="xs" />
							<Text size="xs" c="dimmed">
								AI is on the call…
							</Text>
						</Group>
					)}

					<div ref={scrollRef} />
				</Stack>
			</ScrollArea>

			{hasPendingQuestion && !isEnded && (
				<form onSubmit={answerForm.onSubmit(handleAnswer)}>
					<Group align="flex-end" gap="sm">
						<TextInput
							flex={1}
							placeholder="Type your answer…"
							onKeyDown={(e) => {
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									answerForm.onSubmit(handleAnswer)();
								}
							}}
							{...answerForm.getInputProps("answer")}
						/>
						<Button type="submit" loading={submitting}>
							Send
						</Button>
					</Group>
				</form>
			)}
		</Stack>
	);
}
