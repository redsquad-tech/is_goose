import { Message } from '../api';

export interface ChatType {
  sessionId: string;
  name: string;
  messages: Message[];
}
