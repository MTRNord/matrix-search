import React, { PropsWithChildren } from 'react';
import ReactPDF, { Font, Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import Indexer from './indexer.js';
import Config from './config.js';
import { Hits, SearchParams, SearchResponse } from 'meilisearch';

Font.registerEmojiSource({
    format: 'png',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/',
});


const styles = StyleSheet.create({
    page: {
        fontSize: 12,
        fontFamily: 'Helvetica',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#fff',
        padding: 10,
    }
})

const indexer = new Indexer();

const borderRadius = 5;

// A pdf renderer
const MessageDocument = ({ query, queryResults }: PropsWithChildren<{ query: string, queryResults: { hits: Hits<Record<string, any>>; estimatedTotalHits: number; } }>) => {
    return (
        <Document
            title={`Search results for: "${query}"`}
            producer='Matrix Search Engine'
            keywords='matrix'
        >
            <Page size="A4" style={styles.page}>
                <View>
                    <Text>Search results for: {query}</Text>
                    <Text>Results: {queryResults.estimatedTotalHits}</Text>

                    {queryResults.hits.map((result, index) => (
                        <View key={index} style={{ flexDirection: 'column', margin: 10, padding: 5, backgroundColor: '#e6e6e6', gap: 25, borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius, borderBottomLeftRadius: borderRadius, borderBottomRightRadius: borderRadius }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} >
                                <Text>{result.room_id}</Text>
                                <Text>{result.sender}</Text>
                            </View>
                            <Text>{result.content.body}</Text>
                        </View>
                    ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }} fixed>
                    <Text render={({ pageNumber, totalPages }) => (
                        `${pageNumber} / ${totalPages}`
                    )} />
                    <Text>
                        Matrix Search Engine
                    </Text>
                </View>
            </Page>
        </Document >
    )
}

export async function renderPDFToDisk(query: string, room_id?: string, sender?: string) {
    const queryResults = await indexer.search(query, room_id, sender);
    //console.log(`Search results:`, queryResults);
    ReactPDF.renderToFile(<MessageDocument query={query} queryResults={queryResults} />, `output.pdf`);
}

await renderPDFToDisk("woah", undefined, "@thibaultmartin:matrix.org");
console.log("PDF rendered to disk");