import { Hits, MeiliSearch } from 'meilisearch';
import fs from 'node:fs';

/* This is the indexer. It is a wrapper around orama.
 *
 * It makes sure that the database is persisted on inserts and updates.
 * It also makes sure that the database is loaded on startup.
 * It also ensures the correct search is used.
 * 
*/
export default class Indexer {
    private readonly client = new MeiliSearch({
        host: 'http://localhost:7700',
        apiKey: 'aSampleMasterKey'
    });
    private readonly textIndex = this.client.index('text');

    constructor() {
    }

    // TODO: Properly type the data
    public async insert(data: any) {
        return await this.textIndex.addDocuments([data], { primaryKey: 'id' });
    }

    public async search(query: string, room_id?: string, sender?: string) {

        await this.textIndex.updateSearchableAttributes(['content.body', "sender", "content.m.mentions.user_id"]);
        await this.textIndex.updateFilterableAttributes([
            'id',
            'sender',
            'room_id'
        ])

        let results: Hits<Record<string, any>> = [];
        let page = 1;

        let filter = "";
        if (room_id) {
            filter += `room_id = "${room_id}"`;
        }
        if (sender) {
            if (filter != "") {
                filter += " AND ";
            }
            filter += `sender = "${sender}"`;
        }
        let filters;
        if (filter != "") {
            filters = [filter]
        }

        // Keep searching until we got everything
        let response = await this.textIndex.search(query, { page: page, filter: filters });
        results = results.concat(response.hits);
        while (page < response.totalPages) {
            response = await this.textIndex.search(query, { page: page, filter: filters });
            results = results.concat(response.hits);
            page++;
        }

        return { hits: results, estimatedTotalHits: results.length };
    }
}