import { Type } from "@earendil-works/pi-ai/base";
import type { ThetaToolSchema } from "../tools.ts";

export const thetaBashToolSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute." }),
	cwd: Type.Optional(
		Type.String({ description: "Workspace directory to run the command in." }),
	),
	timeout: Type.Optional(
		Type.Number({ description: "Timeout in seconds for this command." }),
	),
	env: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Environment variables for this command.",
		}),
	),
}) as unknown as ThetaToolSchema;
