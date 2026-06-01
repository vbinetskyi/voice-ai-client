import { Center, Container } from "@mantine/core";
import { useState } from "react";
import { client } from "./api/client.gen";
import { BrowserCallView } from "./components/BrowserCallView";
import { ChatView } from "./components/ChatView";
import { StartCallForm } from "./components/StartCallForm";

client.setConfig({ baseUrl: import.meta.env.VITE_API_BASE as string });

type ActiveSession = { sessionId: string; transport: "twilio" | "browser" };

export default function App() {
	const [active, setActive] = useState<ActiveSession | null>(null);

	return (
		<Center h="100vh">
			<Container
				size={active ? "sm" : "xs"}
				w="100%"
				h={active ? "100%" : undefined}
				py="xl"
			>
				{active ? (
					active.transport === "browser" ? (
						<BrowserCallView sessionId={active.sessionId} />
					) : (
						<ChatView sessionId={active.sessionId} />
					)
				) : (
					<StartCallForm
						onStarted={(sessionId, transport) =>
							setActive({ sessionId, transport })
						}
					/>
				)}
			</Container>
		</Center>
	);
}
