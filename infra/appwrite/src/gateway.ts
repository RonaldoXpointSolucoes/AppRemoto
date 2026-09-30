export type AppwriteDatabase = { readonly $id: string; readonly name: string };
export type AppwriteCollection = {
  readonly $id: string;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly documentSecurity: boolean;
};
export type AppwriteAttribute = {
  readonly key: string;
  readonly type: string;
  readonly required: boolean;
  readonly size?: number;
  readonly elements?: readonly string[];
  readonly array?: boolean;
};
export type AppwriteIndex = {
  readonly key: string;
  readonly type: string;
  readonly attributes: readonly string[];
  readonly orders?: readonly string[];
  readonly lengths?: readonly (number | null)[];
};
export interface AppwriteGateway {
  listDatabases(): Promise<readonly AppwriteDatabase[]>;
  listCollections(databaseId: string): Promise<readonly AppwriteCollection[]>;
  listAttributes(databaseId: string, collectionId: string): Promise<readonly AppwriteAttribute[]>;
  listIndexes(databaseId: string, collectionId: string): Promise<readonly AppwriteIndex[]>;
}
