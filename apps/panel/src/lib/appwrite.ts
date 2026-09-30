import { Account, Client } from 'appwrite';

import { getPublicConfig, type PublicConfig } from './config';

export interface AppwriteSessionClient {
  client: Client;
  account: Account;
}

export function createAppwriteSessionClient(config: PublicConfig = getPublicConfig()): AppwriteSessionClient {
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId);

  return { client, account: new Account(client) };
}
