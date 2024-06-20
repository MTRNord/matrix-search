import React, { PropsWithChildren } from 'react';
import ReactPDF, { Font, Page, Text, View, Document, StyleSheet, Link } from '@react-pdf/renderer';
import Indexer from './indexer.js';
import { Hits } from 'meilisearch';
import prompts, { PromptObject } from 'prompts';

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
const MessageDocument = ({ query, room_id, sender, queryResults }: PropsWithChildren<{ query: string, room_id?: string, sender?: string, queryResults: { hits: Hits<Record<string, any>>; estimatedTotalHits: number; } }>) => {
    return (
        <Document
            title={`Search results for: "${query}"`}
            producer='Matrix Search Engine'
            keywords='matrix'
        >
            <Page size="A4" style={styles.page}>
                {/* Title page which is centered */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", height: "100%" }}>
                    <View style={{ flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                        <Text style={{ fontSize: 24, textAlign: 'center' }}>Matrix Search Engine</Text>
                        <Text style={{ fontSize: 12, textAlign: 'center', marginTop: 5 }}>Search results for: "{query}"</Text>
                        {/* Optionally display the other values of room_id and sender*/}
                        {room_id !== undefined && <Text style={{ fontSize: 12, textAlign: 'center' }}>Room ID: {room_id}</Text>}
                        {sender !== undefined && <Text style={{ fontSize: 12, textAlign: 'center' }}>Sender: {sender}</Text>}
                        {/* Number of results */}
                        <Text style={{ fontSize: 10, textAlign: 'center', marginTop: 10 }}>Number of Results: {queryResults.estimatedTotalHits}</Text>
                        {/* Date of creation */}
                        <Text style={{ fontSize: 10, textAlign: 'center', marginTop: 10 }}>Created at: {new Date().toLocaleString()}</Text>
                    </View>
                </View>
            </Page>
            <Page size="A4" style={styles.page}>
                <View>
                    <View style={{ fontSize: 10 }}>
                        <Text>Search results for: "{query}"</Text>
                        <Text>Number of Results: {queryResults.estimatedTotalHits}</Text>
                    </View>
                    <View>
                        {queryResults.hits.map((result, index) => (
                            <View wrap={false} key={index} style={{ flexDirection: 'column', margin: 10, padding: 5, backgroundColor: '#e6e6e6', gap: 25, borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius, borderBottomLeftRadius: borderRadius, borderBottomRightRadius: borderRadius, borderStyle: 'solid', borderWidth: 1, borderColor: '#00000' }}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', fontSize: 10 }} >
                                    <Text>{result.room_name ?? result.room_id}</Text>
                                    <View style={{ flexDirection: 'row' }}>
                                        <Text>{result.sender}</Text>
                                        <Link style={{ marginLeft: 5 }} src={`https://matrix.to/#/${result.room_id}/${result.id}`}>Link</Link>
                                    </View>
                                </View>
                                <Text>{result.content.body}</Text>
                            </View>
                        ))}
                    </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, fontSize: 10 }} fixed>
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
    let cleanedRoomId = room_id?.trim();
    let cleanedSender = sender?.trim();
    if (cleanedRoomId === "") {
        cleanedRoomId = undefined;
    }
    if (cleanedSender === "") {
        cleanedSender = undefined;
    }
    const queryResults = await indexer.search(query, cleanedRoomId, cleanedSender);
    //console.log(`Search results:`, queryResults);
    await ReactPDF.renderToFile(<MessageDocument query={query} room_id={cleanedRoomId} sender={cleanedSender} queryResults={queryResults} />, `output.pdf`);
}


const questions: PromptObject<string>[] = [
    {
        type: 'text',
        name: 'query',
        initial: "",
        message: 'Enter your search query:',
    },
    {
        type: 'text',
        name: 'room_id',
        initial: undefined,
        message: 'Enter the Room ID:',
    },
    {
        type: 'text',
        name: 'sender',
        initial: undefined,
        message: 'Enter the sender:',
    }
]

const response = await prompts(questions);

await renderPDFToDisk(response.query as string, response.room_id as string | undefined, response.sender as string | undefined);
console.log("PDF rendered to disk");