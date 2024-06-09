import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import fs from 'node:fs';
import YAML from 'yaml';

// The config schema
const ConfigSchema = Type.Object({
    homeserverUrl: Type.String(),
    accessToken: Type.String(),
});

export type ConfigSchema = Static<typeof ConfigSchema>;

// A config loader with strict schema types using typebox
export default class Config {
    private config: ConfigSchema;

    constructor() {
        // Load the config from the env and use the config for the rest.
        // Then verify the config against the schema
        const config = {
            homeserverUrl: process.env.HOMESERVER_URL,
            accessToken: process.env.ACCESS_TOKEN,
        };

        // load the config file async and merge it with the env
        const configFile = fs.readFileSync('config.yaml', 'utf-8');
        const configFromFile = YAML.parse(configFile);
        const mergedConfig = {
            ...config,
            ...configFromFile
        };

        // Verify the config against the schema
        if (!Value.Check(ConfigSchema, mergedConfig)) {
            throw new Error('Invalid config');
        }
        this.config = mergedConfig;
    }

    public get homeserverUrl(): string {
        return this.config.homeserverUrl;
    }

    public get accessToken(): string {
        return this.config.accessToken;
    }

    public set homeserverUrl(value: string) {
        this.config.homeserverUrl = value;
        this.save();
    }

    public set accessToken(value: string) {
        this.config.accessToken = value;
        this.save();
    }

    public save() {
        fs.writeFileSync('config.yaml', YAML.stringify(this.config));
    }
}