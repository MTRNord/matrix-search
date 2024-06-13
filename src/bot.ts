import Indexer from "./indexer.js";
import Config from "./config.js";
import fs from "node:fs";
import { MatrixClient } from "./tiny-sdk.js";
import { RoomId } from "@matrix-org/matrix-sdk-crypto-nodejs";

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

                if (event["type"] === "m.room.encrypted") {
                    const rawEvent = await client.olmMachine?.decryptRoomEvent(JSON.stringify(event), new RoomId(room));
                    if (rawEvent) {
                        event = JSON.parse(rawEvent.event);
                    }
                }
                void handleMessages(indexer, client, room, event)

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

async function handleMessages(indexer: Indexer, client: MatrixClient, roomId: string, event: any) {
    if (event["content"]["msgtype"] === "m.text") {
        //console.info(`Received message in room ${roomId}`);
        if (event.content["m.relates_to"]) {
            if (event.content["m.relates_to"].rel_type === "m.replace") {
                //console.info(`Removing original event ${event.content["m.relates_to"].event_id}`);
                await indexer.delete(normalizeEventId(event.content["m.relates_to"].event_id as string));
            }
        }

        const room_name = await client.getRoomName(roomId);
        await indexer.insert(convertEventToDocument(event, roomId, room_name));
    }
}

async function handleSync(client: MatrixClient, indexer: Indexer) {
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