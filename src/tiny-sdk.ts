/// A tiny sdk for matrix

import { GetRoomMessagesRequest, GetRoomMessagesResponse, Received, RoomEventFilter } from "./matrix.js";
import got from "got";
import {
    DeviceId,
    DeviceLists,
    KeysBackupRequest,
    KeysClaimRequest,
    KeysQueryRequest,
    KeysUploadRequest,
    OlmMachine,
    RequestType,
    RoomId,
    RoomMessageRequest,
    SignatureUploadRequest,
    StoreType,
    ToDeviceRequest,
    UserId
} from "@matrix-org/matrix-sdk-crypto-nodejs";
import fs from 'node:fs/promises';

export const directions = { forward: "f", reverse: "b" } as const;

export type WhoAmIResponse = {
    device_id?: string;
    user_id: string;
    is_guest?: boolean;
}

export class MatrixClient {
    private userId?: UserId;
    private deviceId?: DeviceId;
    public olmMachine?: OlmMachine;
    private syncRunning: boolean = true;
    private roomNameCache: Record<string, string | boolean> = {};

    constructor(private homeserver: string, private token: string) { }

    async start() {
        const whoami = await this.whoami();
        console.log(`Logged in as ${whoami.user_id}`);

        this.userId = new UserId(whoami.user_id);

        // Use the existing id or a random one to create a new DeviceId object
        // 1. check if we have a device_id
        // 2. if we don't, create a random string
        // 3. create a new DeviceId object
        const device_id = whoami.device_id ?? Math.random().toString(36).substring(7);
        this.deviceId = new DeviceId(device_id);

        this.olmMachine = await OlmMachine.initialize(this.userId, this.deviceId, "./storage/crypto", undefined, StoreType.Sqlite);

        console.log("Client started")
    }

    // Reads the storage/bot.json for the syncToken field.
    // Also handle the case where the file doesn't exist.
    async getSyncTokenFromStorage(): Promise<string | undefined> {
        try {
            const file = await fs.readFile("./storage/bot.json", "utf-8");
            const json = JSON.parse(file);
            return json.syncToken as string | undefined;
        } catch (e) {
            return undefined;
        }
    }

    // Writes the syncToken to the storage/bot.json
    // Ensure we dont fail if the file doesn't exist
    async setSyncTokenToStorage(syncToken: string) {
        console.log("Setting sync token to", syncToken);
        await fs.writeFile("./storage/bot.json", JSON.stringify({ syncToken }));
    }

    async * sync(): AsyncGenerator<Record<string, any>, void, void> {
        if (!this.olmMachine || !this.token) {
            throw new Error("Client not started");
        }
        do {
            let url = "/_matrix/client/v3/sync";
            const syncToken = await this.getSyncTokenFromStorage();
            console.log("Syncing with token", syncToken);
            if (syncToken) {
                url += `?since=${syncToken}`;
            }

            let syncResp: Record<string, any>;
            try {
                syncResp = await this.getRequest(url, {}, 30 * 1000);
            } catch { continue }

            const toDeviceEvents: Record<string, any>[] | undefined = syncResp.to_device?.events;
            const oneTimeKeyCounts: Record<string, number> = syncResp.device_one_time_keys_count;
            const unusedFallbackKeys: Array<string> = syncResp.device_unused_fallback_key_types;
            const leftDevices: UserId[] | undefined = syncResp.device_lists?.left?.map((u: string) => new UserId(u));
            const changedDevices: UserId[] | undefined = syncResp.device_lists?.changed?.map((u: string) => new UserId(u));


            const deviceList = new DeviceLists(changedDevices, leftDevices);
            await this.olmMachine.receiveSyncChanges(
                JSON.stringify(toDeviceEvents) ?? "[]",
                deviceList,
                oneTimeKeyCounts,
                unusedFallbackKeys,
            );


            const outgoingRequests = await this.olmMachine.outgoingRequests();
            // Send outgoing requests
            for (const request of outgoingRequests) {
                // Switch on the request type
                try {
                    switch (request.type) {
                        case RequestType.KeysUpload: {
                            const keysUploadRequest = request as KeysUploadRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/upload", {}, keysUploadRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.KeysBackup: {
                            const keysBackupRequest = request as KeysBackupRequest;
                            const resp = await this.putRequest("/_matrix/client/v3/room_keys/keys", {}, keysBackupRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.KeysClaim: {
                            const keysClaimRequest = request as KeysClaimRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/claim", {}, keysClaimRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.KeysQuery: {
                            const keysQueryRequest = request as KeysQueryRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/query", {}, keysQueryRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.SignatureUpload: {
                            const signatureUploadRequest = request as SignatureUploadRequest;
                            const resp = await this.postRequest("/_matrix/client/v3/keys/signatures/upload", {}, signatureUploadRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.ToDevice: {
                            const toDeviceRequest = request as ToDeviceRequest;
                            const resp = await this.postRequest(`/_matrix/client/v3/sendToDevice/${toDeviceRequest.eventType}/${toDeviceRequest.txnId}`, {}, toDeviceRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        case RequestType.RoomMessage: {
                            const roomMessageRequest = request as RoomMessageRequest;
                            const resp = await this.postRequest(`/_matrix/client/v3/rooms/${roomMessageRequest.roomId}/send/${roomMessageRequest.eventType}/${roomMessageRequest.txnId}`, {}, roomMessageRequest.body, 30 * 1000);
                            await this.olmMachine.markRequestAsSent(request.id, request.type, JSON.stringify(resp));
                            break;
                        }
                        default:
                            console.error("Unknown request type", request);
                    }
                } catch (e) {
                    console.error("Failed to send request", e);
                    // We retry
                    continue;
                }
            }
            console.log("Synced", syncResp.next_batch as string)

            // Save the sync token
            await this.setSyncTokenToStorage(syncResp.next_batch as string);

            // decrypt all events here. for our usecase we only care about joined rooms
            await Promise.all(Object.entries(syncResp.rooms.join as Record<string, any>).map(async ([roomId, room]: [string, any]) => {
                await Promise.all(room.timeline.events.map(async (event: Record<string, any>) => {
                    if (event.type === "m.room.encrypted") {
                        try {
                            const rawEvent = await this.olmMachine?.decryptRoomEvent(JSON.stringify(event), new RoomId(roomId));
                            if (rawEvent) {
                                event = JSON.parse(rawEvent.event);
                            } else {
                                //console.warn("Failed to decrypt event", event);
                                return event;
                            }
                        } catch (e) {
                            //console.warn("Failed to decrypt event", e);
                            return event;
                        }
                    }
                }));
            }));

            yield syncResp;
        } while (this.syncRunning);
    }

    async whoami(): Promise<WhoAmIResponse> {
        return await this.getRequest("/_matrix/client/v3/account/whoami", {}, 30 * 1000) as WhoAmIResponse;
    }

    // Fetches the room name from the cache or the server
    async getRoomName(roomId: string): Promise<string | undefined> {
        if (typeof this.roomNameCache[roomId] === "string") {
            return this.roomNameCache[roomId] as string;
        } else if (this.roomNameCache[roomId] === false) {
            return;
        }

        try {
            const room_name_resp = await this.getRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`, {}, 30 * 1000);
            const room_name = room_name_resp.name;
            if (room_name) {
                this.roomNameCache[roomId] = room_name;
                return room_name as string;
            }
        } catch {
            this.roomNameCache[roomId] = false;
            return;
        }
    }

    async getRequest(path: string, query: Record<string, any>, timeout: number): Promise<any> {
        if (!this.token) {
            throw new Error("Client not started");
        }
        return await got.get(`${this.homeserver}${path}`, {
            searchParams: query, timeout: {
                request: timeout
            }, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.token}` }
        }).json();
    }

    async postRequest(path: string, query: Record<string, any>, body: string, timeout: number): Promise<any> {
        if (!this.token) {
            throw new Error("Client not started");
        }
        return await got.post(`${this.homeserver}${path}`, {
            searchParams: query, body, timeout: {
                request: timeout
            }, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.token}` }
        }).json();
    }

    async putRequest(path: string, query: Record<string, any>, body: string, timeout: number): Promise<any> {
        if (!this.token) {
            throw new Error("Client not started");
        }
        return await got.put(`${this.homeserver}${path}`, {
            searchParams: query, body, timeout: {
                request: timeout
            }, headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.token}` }
        }).json();
    }

    async getJoinedRooms(): Promise<string[]> {
        const response = await this.getRequest("/_matrix/client/v3/joined_rooms", {}, 30 * 1000);
        return response.joined_rooms as string[];
    }

    async * getRoomEvents(
        room: string,
        direction: "forward" | "reverse",
        filter?: RoomEventFilter
    ): AsyncGenerator<Received<any>[], void, void> {
        const path = `/_matrix/client/v3/rooms/${encodeURIComponent(room)}/messages`;
        const base: GetRoomMessagesRequest = {
            ...(direction && { dir: directions[direction] }),
            ...(filter && { filter: JSON.stringify(filter) }),
        };

        let from: string | undefined;
        do {
            const query: GetRoomMessagesRequest = { ...base, ...(from && { from }) };

            // We request but try at least 5 times
            let response: GetRoomMessagesResponse | undefined = undefined;
            for (let i = 0; i < 15; i++) {
                try {
                    response = await this.getRequest(path, query, 120 * 1000);
                    break;
                } catch (e) {
                    console.error("Failed to get messages, retrying", e);
                    // Wait 1s before retrying
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }

            if (!response) {
                console.error("Failed to get messages");
                break;
            }
            from = response.end;
            yield response.chunk;
        } while (from);
    }
}