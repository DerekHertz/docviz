// Isolate historical modules' import-time cache directories without modifying their source.
import os from 'node:os';
import {syncBuiltinESMExports} from 'node:module';
if(!process.env.DOCVIZ_CAPTURE_HOME)throw new Error('Set a dedicated DOCVIZ_CAPTURE_HOME for captured executions.');
os.homedir=()=>process.env.DOCVIZ_CAPTURE_HOME;
syncBuiltinESMExports();
