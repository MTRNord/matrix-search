import { AnyOrama, create, insert, search } from '@orama/orama';
import { persistToFile, restoreFromFile } from '@orama/plugin-data-persistence/server';
import fs from 'node:fs';

/* This is the indexer. It is a wrapper around orama.
 *
 * It makes sure that the database is persisted on inserts and updates.
 * It also makes sure that the database is loaded on startup.
 * It also ensures the correct search is used.
 * 
*/
export default class Indexer {
    private db?: AnyOrama;

    public async init() {
        const filePath = 'db.msp';
        // Check if database exists
        if (!fs.existsSync(filePath)) {
            // Create database
            this.db = await create({
                schema: {
                    room_id: 'string',
                    text: {
                        body: 'string',
                        formatted_body: 'string',
                        "m.mentions": {
                            user_ids: 'string[]'
                        },
                        "m.relates_to": {
                            "m.in_reply_to": {
                                event_id: 'string'
                            }
                        },
                    }
                },
                components: {
                    tokenizer: {
                        stemmerSkipProperties: ['room_id']
                    }
                }
            });
            await persistToFile(this.db, 'binary', filePath);
        } else {
            // Load database
            this.db = await restoreFromFile('binary', filePath);
        }
    }

    // TODO: Properly type the data
    public async insert(data: any) {
        if (!this.db) {
            throw new Error('Database not initialized');
        }
        return await insert(this.db, data);
    }

    public async search(query: string) {
        if (!this.db) {
            throw new Error('Database not initialized');
        }
        return await search(this.db, { term: query });
    }
}