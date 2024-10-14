import Indexer from "./indexer.js";
import Config from "./config.js";
import fs from "node:fs";
import { MatrixClient } from "./tiny-sdk.js";
import { renderPDFToBufferWithData } from "./renderer.js";

// Ensures no matrix IDs are in the content.body
function cleanContent(content: Record<string, any>) {
    if (typeof content !== "object") return content;
    if (content.body) {
        content.body = content.body.replaceAll(/@[a-zA-Z0-9_\-.=]+:[a-zA-Z0-9\-.]+/g, "<mxid>");
    }
    return content;
}

type BackfillState = {
    rooms: string[];
};

async function backfill(client: MatrixClient, indexer: Indexer) {
    // Check if we have a state file
    const filePath = "./storage/backfillState.json";
    if (!fs.existsSync(filePath)) {
        console.info("No backfill state found, writing empty state file");
        fs.writeFileSync(filePath, "{\"rooms\":[]}");
    }

    const stateJson = fs.readFileSync(filePath, "utf-8");
    const state: BackfillState = JSON.parse(stateJson);

    console.info("Indexing existing messages")
    const joined_rooms = await client.getJoinedRooms();

    // Remvoe rooms we've already indexed.
    // The already indexed are a list of strings in the rooms object on our state
    const newRooms = joined_rooms.filter(room => !state.rooms.includes(room));

    // Save the state file
    fs.writeFileSync(filePath, JSON.stringify(state));

    const editedEvents: string[] = [];

    for (const room of newRooms) {
        const pages = client.getRoomEvents(room, "reverse", { types: ["m.room.message"] });
        for await (const page of pages) {
            for (const rawEvent of page) {
                let event: Record<string, any> = rawEvent as Record<string, any>;
                if (editedEvents.includes(event["event_id"] as string)) {
                    continue;
                }
                if (event.content["m.relates_to"]) {
                    if (event.content["m.relates_to"].rel_type === "m.replace") {
                        editedEvents.push(event.content["m.relates_to"].event_id as string);
                    }
                }

                event = await client.decryptEvent(event, room);
                void handleMessages(indexer, client, room, event, true);

            }
        }

        // Add the room to the state and save it
        state.rooms.push(room);
        fs.writeFileSync(filePath, JSON.stringify(state));
    }
}

function normalizeEventId(eventId: string) {
    return eventId.replaceAll("$", "").replaceAll(":", "_").replaceAll(".", "_").replaceAll("!", "_");
}

function convertEventToDocument(event: any, roomId: string, room_name?: string) {
    const doc: {
        id: string,
        sender: string,
        content: any,
        room_id: string,
        origin_server_ts: string,
        room_name?: string
    } = {
        id: normalizeEventId(event["event_id"] as string),
        sender: event["sender"],
        content: cleanContent(event["content"] as Record<string, any>),
        room_id: roomId,
        origin_server_ts: event["origin_server_ts"],
    }
    if (room_name) {
        doc.room_name = room_name
    }

    return doc
}

async function handleMessages(indexer: Indexer, client: MatrixClient, roomId: string, event: any, historical = false) {
    if (event["content"]["msgtype"] === "m.text") {
        const user = await client.whoami();
        // If command and sender is bot user then handle as a command and not index
        if (event["content"]["body"].startsWith("!") && event["sender"] === user.user_id && !historical) {
            // Get the command directly after the ! (e.g. !search -> search)
            const command = event["content"]["body"].split(" ")[0].substring(1);
            const args: string[] = event["content"]["body"].split(" ").slice(1);

            // Render the amount of events given in the argument (e.g. !last 5) as a pdf and send it into the room
            if (command === "last") {
                console.info(`Received "last" command in room ${roomId}`);

                const amount = parseInt(args[0]);
                console.info(`Rendering last ${amount} messages as PDF`);
                const results = await indexer.search("", roomId, undefined, amount);
                console.info(`Got ${results.hits.length} results`);
                const pdf = await renderPDFToBufferWithData(results, "", roomId, undefined);

                const event_id = event["event_id"] as string;
                await client.sendFile(roomId, event_id, "Here is the PDF with the last " + amount + " messages", pdf);

                // Redact the original command message
                await client.redactEvent(roomId, event_id, "Redacted by bot");
                return;
            }
        }


        //console.info(`Received message in room ${roomId}`);
        if (event.content["m.relates_to"]) {
            if (event.content["m.relates_to"].rel_type === "m.replace") {
                //console.info(`Removing original event ${event.content["m.relates_to"].event_id}`);
                await indexer.delete(normalizeEventId(event.content["m.relates_to"].event_id as string));
            }
        }

        const room_name = await client.getRoomName(roomId);

        void indexer.insert(convertEventToDocument(event, roomId, room_name));
    }
}

async function handleSync(client: MatrixClient, indexer: Indexer) {
    console.info("Starting sync");
    const events = client.sync();
    for await (const [roomId, event] of events) {
        void handleMessages(indexer, client, roomId, event)
    }
}

async function run() {
    const config = new Config();
    const homeserverUrl = config.homeserverUrl;
    const accessToken = config.accessToken;
    const indexer = new Indexer();

    const client = new MatrixClient(homeserverUrl, accessToken);
    await client.start();

    await Promise.allSettled([handleSync(client, indexer), backfill(client, indexer)]);


    await client.start();
    console.info("Bot started!");


}

await run();