'use client';

import 'client-only';
import { Account, Client } from 'appwrite';

import { getPublicConfig, type PublicConfig } from './config';
import { createSessionJwtGetter, type SessionJwtGetter } from './session-jwt';

export interface AppwriteSessionClient {
  client: Client;
  account: Account;
  getJwt: SessionJwtGetter;
}

export function createAppwriteSessionClient(config: PublicConfig = getPublicConfig()): AppwriteSessionClient {
  const client = new Client()
    .setEndpoint(config.appwriteEndpoint)
    .setProject(config.appwriteProjectId);

  const account = new Account(client);
  const getJwt = createSessionJwtGetter(JSON.stringify([config.appwriteEndpoint, config.appwriteProjectId]), () => account.createJWT());
  return { client, account, getJwt };
}
