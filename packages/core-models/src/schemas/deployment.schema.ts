import { z } from 'zod/v4';

export const sendMessageInputSchema = z.object({
  content: z.string().min(1, 'Message content must not be empty'),
});

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;
