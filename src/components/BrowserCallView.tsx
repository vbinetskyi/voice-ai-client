import {
	ActionIcon,
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
import micProcessorUrl from "../audio/mic-processor.js?url";

// ── Types ─────────────────────────────────────────────────────────────────────

type Message =
	| { id: string; type: "status"; text: string; status: string }
	| { id: string; type: "question"; question: string; context: string }
	| { id: string; type: "answer"; text: string }
	| { id: string; type: "error"; text: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
	idle: "Idle",
	dialing: "Connecting…",
	active: "Active",
	awaiting_input: "Waiting for your answer",
	ended: "Ended",
};

const STATUS_COLORS: Record<string, string> = {
	idle: "gray",
	dialing: "blue",
	active: "green",
	awaiting_input: "orange",
	ended: "gray",
};

const uid = () =>
	crypto.randomUUID?.() ??
	"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
	});

const SAMPLE_RATE = 24000; // must match server — AudioContext at 24 kHz

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
	sessionId: string;
}

export function BrowserCallView({ sessionId }: Props) {
	const [session, setSession] = useState<Session | null>(null);
	const [messages, setMessages] = useState<Message[]>([
		{ id: uid(), type: "status", text: "Connecting…", status: "dialing" },
	]);
	const [submitting, setSubmitting] = useState(false);
	const [endingCall, setEndingCall] = useState(false);
	const [micActive, setMicActive] = useState(false);
	const [audioError, setAudioError] = useState<string | null>(null);

	// Pre-seed to "dialing" to match the initial "Connecting…" message already
	// in state — prevents the first poll from adding a duplicate status badge.
	const lastStatusRef = useRef<string | null>("dialing");
	const lastQuestionRef = useRef<string | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const consecutiveErrorsRef = useRef(0);

	// Audio infrastructure refs — created once, torn down on unmount/end.
	const wsRef = useRef<WebSocket | null>(null);
	const audioCtxRef = useRef<AudioContext | null>(null);
	const micStreamRef = useRef<MediaStream | null>(null);
	const workletNodeRef = useRef<AudioWorkletNode | null>(null);
	const nextPlayTimeRef = useRef(0);

	const answerForm = useForm({ initialValues: { answer: "" } });

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: "smooth" });
	});

	// ── Polling ────────────────────────────────────────────────────────────────

	const polling = useInterval(async () => {
		const { data, error } = await getSessionsById({ path: { id: sessionId } });

		if (error || !data) {
			const isNotFound =
				typeof error === "object" &&
				error !== null &&
				"error" in error &&
				(error as { error: string }).error === "Not found";

			if (isNotFound) {
				polling.stop();
				await teardownAll();
				setMessages((prev) => [
					...prev,
					{ id: uid(), type: "error", text: "Session not found" },
				]);
				return;
			}

			consecutiveErrorsRef.current += 1;
			if (consecutiveErrorsRef.current >= 3) {
				polling.stop();
				await teardownAll();
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
			if (data.status === "ended") {
				polling.stop();
				teardownAll();
			}
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

	// ── Audio setup ────────────────────────────────────────────────────────────

	// Stops mic stream + worklet only; AudioContext and WS stay alive for playback.
	// Safe to call multiple times — all accesses are ?.-guarded and refs are nulled.
	function stopMic() {
		workletNodeRef.current?.disconnect();
		workletNodeRef.current = null;
		for (const track of micStreamRef.current?.getTracks() ?? []) {
			track.stop();
		}
		micStreamRef.current = null;
		setMicActive(false);
	}

	// Closes everything — called on End or session ended.
	// Awaits AudioContext.close() so the OS audio device is released before any
	// new AudioContext can be created (Chrome enforces a concurrent-context limit).
	// Nulls wsRef before closing so ws.onclose calling teardownAll() is a no-op.
	async function teardownAll() {
		stopMic();
		const ws = wsRef.current;
		wsRef.current = null;
		ws?.close();
		const ctx = audioCtxRef.current;
		audioCtxRef.current = null;
		nextPlayTimeRef.current = 0;
		if (ctx) await ctx.close();
	}

	// Starts or restarts the mic.
	// First call: creates AudioContext + WS then starts the mic.
	// Subsequent calls (after stopMic): re-acquires mic into the existing pipeline.
	async function startMic() {
		setAudioError(null);
		try {
			// Mic capture with echo cancellation to prevent feedback loops.
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true },
			});
			micStreamRef.current = stream;

			// First start: initialise AudioContext and WS.
			if (!audioCtxRef.current) {
				// AudioContext at 24 kHz — same rate as the server/Grok pipeline.
				// Both send and receive paths are pass-throughs with no resampling.
				const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
				audioCtxRef.current = ctx;
				nextPlayTimeRef.current = 0;

				await ctx.audioWorklet.addModule(micProcessorUrl);

				const ws = new WebSocket(
					`${import.meta.env.VITE_WS_BASE as string}/browser-stream/${sessionId}`,
				);
				wsRef.current = ws;
				ws.binaryType = "arraybuffer";
				ws.onmessage = (evt: MessageEvent<ArrayBuffer>) =>
					playChunk(ctx, evt.data);
				ws.onerror = () => setAudioError("WebSocket error — check the server");
				// Server-initiated close: teardown mic/AudioContext so OS resources
				// are released. wsRef is already nulled inside teardownAll so the
				// recursive call path is a no-op.
				ws.onclose = () => {
					teardownAll().catch(() => {});
				};
			}

			const ctx = audioCtxRef.current;
			const source = ctx.createMediaStreamSource(stream);
			const worklet = new AudioWorkletNode(ctx, "mic-processor");
			workletNodeRef.current = worklet;

			// Forward PCM16 frames to the server.
			worklet.port.onmessage = (evt: MessageEvent<ArrayBuffer>) => {
				if (wsRef.current?.readyState === WebSocket.OPEN) {
					wsRef.current.send(evt.data);
				}
			};

			source.connect(worklet);
			// Connect to destination so Chrome pulls audio through the graph.
			// process() writes silence to outputs — no mic loopback to speaker.
			worklet.connect(ctx.destination);

			setMicActive(true);
		} catch (err) {
			setAudioError(
				err instanceof Error ? err.message : "Failed to start microphone",
			);
			stopMic();
		}
	}

	// Schedules an incoming PCM16 LE chunk for gapless playback.
	function playChunk(ctx: AudioContext, buffer: ArrayBuffer) {
		const int16 = new Int16Array(buffer);
		const float32 = new Float32Array(int16.length);
		for (let i = 0; i < int16.length; i++) {
			float32[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
		}
		const audioBuffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
		audioBuffer.copyToChannel(float32, 0);
		const source = ctx.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(ctx.destination);
		const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
		source.start(startAt);
		nextPlayTimeRef.current = startAt + audioBuffer.duration;
	}

	// ── Actions ────────────────────────────────────────────────────────────────

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
		polling.stop();
		await teardownAll();
	}

	// Tear down audio on unmount. teardownAll only closes refs — stable across renders.
	// biome-ignore lint/correctness/useExhaustiveDependencies: teardownAll only closes refs, safe to omit
	useEffect(() => {
		return () => {
			teardownAll();
		};
	}, []);

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
							End
						</Button>
					)}
				</Group>
			</Group>

			{/* Mic control */}
			{!isEnded && (
				<Group gap="sm">
					<ActionIcon
						size="xl"
						radius="xl"
						color={micActive ? "red" : "blue"}
						variant={micActive ? "filled" : "outline"}
						onClick={micActive ? stopMic : startMic}
						title={micActive ? "Stop microphone" : "Start microphone"}
					>
						{micActive ? "🔴" : "🎙️"}
					</ActionIcon>
					<Text size="sm" c="dimmed">
						{micActive
							? "Mic on — speaking to AI"
							: "Click to start microphone"}
					</Text>
				</Group>
			)}

			{audioError && (
				<Alert color="red" variant="light">
					{audioError}
				</Alert>
			)}

			{/* Chat — clarifying questions */}
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

					{!isEnded &&
						!hasPendingQuestion &&
						session?.status === "active" &&
						micActive && (
							<Group gap="xs">
								<Loader size="xs" />
								<Text size="xs" c="dimmed">
									AI is listening…
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
