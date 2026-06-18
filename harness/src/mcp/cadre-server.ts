#!/usr/bin/env node
import { handle } from "./server-runtime";
import { startStdioTransport } from "./stdio-transport";

startStdioTransport(handle);
