import React, { PropsWithChildren } from 'react';
import ReactPDF, { Font, Page, Text, View, Document, StyleSheet } from '@react-pdf/renderer';
import Indexer from './indexer.js';
import { Results, AnyDocument } from '@orama/orama';

Font.registerEmojiSource({
    format: 'png',
    url: 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/',
});


const styles = StyleSheet.create({
    page: {
        fontSize: 16,
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: '#fff',
        padding: 10,
    }
})

const indexer = new Indexer();
await indexer.init();
await indexer.insert({ text: { body: "Hello, World with test!" } });

// A pdf renderer
const MessageDocument = ({ query, queryResults }: PropsWithChildren<{ query: string, queryResults: Results<AnyDocument> }>) => {
    return (
        <Document
            title={`Search results for: "${query}"`}
            producer='Matrix Search Engine'
            keywords='matrix'
        >
            <Page size="A4" style={styles.page}>
                <View>
                    <Text>Search results for: {query}</Text>
                    <Text>Results: {queryResults.count}</Text>

                    {queryResults.hits.map((result, index) => (
                        <View key={index}>
                            <Text>{JSON.stringify(result.document, null, 2)}</Text>
                        </View>
                    ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} >
                    <Text render={({ pageNumber, totalPages }) => (
                        `${pageNumber} / ${totalPages}`
                    )} fixed />
                    <Text fixed>
                        Matrix Search Engine
                    </Text>
                </View>
            </Page>
        </Document >
    )
}

export async function renderPDFToDisk(query: string) {
    const queryResults = await indexer.search(query);
    ReactPDF.renderToFile(<MessageDocument query={query} queryResults={queryResults} />, `output.pdf`);
}

await renderPDFToDisk("test");