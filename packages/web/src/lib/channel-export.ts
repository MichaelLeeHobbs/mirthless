import { api } from '../api/client.js';
import { saveFile } from './download.js';

export async function downloadChannelExport(channelId?: string): Promise<void> {
  const path = channelId ? `/channels/${channelId}/export` : '/channels/export';
  const response = await api.get<unknown>(path);
  if (!response.success) {
    throw new Error(response.error.message);
  }

  saveFile(channelId ? `channel-${channelId}.json` : 'channels-export.json', JSON.stringify(response.data, null, 2), 'application/json');
}
