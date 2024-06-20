import { Hits, MeiliSearch } from 'meilisearch';
import Config from './config.js';

const config = new Config();

/* This is the indexer. It is a wrapper around orama.
 *
 * It makes sure that the database is persisted on inserts and updates.
 * It also makes sure that the database is loaded on startup.
 * It also ensures the correct search is used.
 * 
*/
export default class Indexer {
    private readonly client = new MeiliSearch({
        host: config.meiliSearchHost,
        apiKey: config.meiliSearchKey
    });
    private readonly textIndex = this.client.index('text');

    constructor() {
    }

    // TODO: Properly type the data
    public async insert(data: Record<string, any>) {
        return await this.textIndex.addDocuments([data], { primaryKey: 'id' });
    }

    public async search(query: string, room_id?: string, sender?: string) {

        await this.textIndex.updateSearchableAttributes(['content.body', "sender", "content.m.mentions.user_id", "room_name"]);
        await this.textIndex.updateFilterableAttributes([
            'id',
            'sender',
            'room_id',
            'origin_server_ts'
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

    public async delete(event_id: string) {
        return await this.textIndex.deleteDocument(event_id);
    }
}