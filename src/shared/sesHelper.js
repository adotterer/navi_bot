import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Sends a 2FA verification code to the specified email address using Amazon SES.
 */
export async function send2FACode(email, code) {
    const sender = process.env.SES_SENDER_EMAIL;
    if (!sender) {
        throw new Error("SES_SENDER_EMAIL environment variable is not set.");
    }

    const command = new SendEmailCommand({
        Source: sender,
        Destination: {
            ToAddresses: [email],
        },
        Message: {
            Subject: {
                Data: "Verification Code",
            },
            Body: {
                Text: {
                    Data: `Your verification code is: ${code}`,
                },
            },
        },
    });

    return sesClient.send(command);
}
