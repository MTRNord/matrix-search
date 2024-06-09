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
    private client = new MeiliSearch({
        host: 'http://localhost:7700',
        apiKey: 'aSampleMasterKey'
    });

    constructor() { }

    // TODO: Properly type the data
    public async insert(data: any) {
        const index = this.client.index('text');
        return await index.addDocuments([data], { primaryKey: 'id' });
    }

    public async search(query: string) {
        const index = this.client.index('text');
        let results: Hits<Record<string, any>> = [];
        let page = 1;
        // Keep searching until we got everything
        let response = await index.search(query, { page: page });
        results = results.concat(response.hits);
        while (page < response.totalPages) {
            response = await index.search(query, { page: page });
            results = results.concat(response.hits);
            page++;
        }

        return { hits: results, estimatedTotalHits: results.length };
    }
}