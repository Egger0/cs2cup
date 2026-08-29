export type StoredObjectBody = ArrayBuffer | ReadableStream<Uint8Array>

export interface StoredFile {
  key: string
}

export interface StoredObject {
  body: StoredObjectBody
  contentType: string
  size?: number
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredFile>
  get(key: string): Promise<StoredObject | null>
  delete(key: string): Promise<void>
}
