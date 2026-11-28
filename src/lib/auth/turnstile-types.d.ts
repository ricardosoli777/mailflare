export type TurnstileAction = "login" | "password-reset" | "setup" | "capture";

export type TurnstileResponse = {
	success: boolean;
	action?: string;
	hostname?: string;
	metadata?: { result_with_testing_key?: boolean };
	"error-codes"?: string[];
};
