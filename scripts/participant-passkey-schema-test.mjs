import { testParticipantPasskeyCeremonySchema } from './participant-passkey-ceremony-schema-test.mjs'
import { testParticipantPasskeyCredentialSchema } from './participant-passkey-credential-schema-test.mjs'
import { createPasskeySchemaDatabase } from './participant-passkey-schema-fixture.mjs'
import { testParticipantSessionSchema } from './participant-session-schema-test.mjs'

const database = await createPasskeySchemaDatabase()

try {
  testParticipantPasskeyCredentialSchema(database)
  testParticipantSessionSchema(database)
  testParticipantPasskeyCeremonySchema(database)
  console.log('participant passkey schema tests passed')
} finally {
  database.close()
}
