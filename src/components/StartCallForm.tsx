import {
	Alert,
	Button,
	Radio,
	Stack,
	Text,
	Textarea,
	TextInput,
	Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";
import { postCalls, postSessionsBrowser } from "../api";

interface Props {
	onStarted: (sessionId: string, transport: "twilio" | "browser") => void;
}

export function StartCallForm({ onStarted }: Props) {
	const [error, setError] = useState<string | null>(null);
	const [transport, setTransport] = useState<"twilio" | "browser">("browser");

	const form = useForm({
		initialValues: { goal: "", phoneNumber: "" },
		validate: {
			goal: (v) => (v.trim().length === 0 ? "Goal is required" : null),
			phoneNumber: (v) => {
				if (transport === "browser") return null;
				return v.trim().length === 0 ? "Phone number is required" : null;
			},
		},
	});

	async function handleSubmit(values: { goal: string; phoneNumber: string }) {
		setError(null);

		if (transport === "browser") {
			const { data, error: err } = await postSessionsBrowser({
				body: { goal: values.goal },
			});
			if (err || !data) {
				setError(
					(err as { error?: string })?.error ?? "Failed to start session",
				);
				return;
			}
			onStarted(data.sessionId, "browser");
			return;
		}

		const { data, error: err } = await postCalls({ body: values });
		if (err || !data) {
			setError((err as { error?: string })?.error ?? "Failed to start call");
			return;
		}
		onStarted(data.sessionId, "twilio");
	}

	return (
		<Stack gap="lg">
			<Title order={2}>Voice AI</Title>
			<Text c="dimmed">Choose a mode and start a session.</Text>
			<form onSubmit={form.onSubmit(handleSubmit)}>
				<Stack gap="sm">
					<Radio.Group
						label="Mode"
						value={transport}
						onChange={(v) => setTransport(v as "twilio" | "browser")}
					>
						<Stack gap="xs" mt={4}>
							<Radio
								value="twilio"
								label="Phone call (Twilio)"
								description="AI calls a phone number on your behalf"
							/>
							<Radio
								value="browser"
								label="Browser (microphone)"
								description="Speak directly with the AI in your browser"
							/>
						</Stack>
					</Radio.Group>

					<Textarea
						label="Goal"
						placeholder="Have a casual conversation"
						autosize
						minRows={2}
						{...form.getInputProps("goal")}
					/>

					{transport === "twilio" && (
						<TextInput
							label="Phone number"
							placeholder="+15551234567"
							{...form.getInputProps("phoneNumber")}
						/>
					)}

					{error && <Alert color="red">{error}</Alert>}
					<Button type="submit">Start</Button>
				</Stack>
			</form>
		</Stack>
	);
}
