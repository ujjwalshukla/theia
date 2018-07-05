/********************************************************************************
 * Copyright (C) 2017 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as path from 'path';
import * as yargs from 'yargs';
import * as fs from 'fs-extra';
import * as os from 'os';

import { injectable, inject, postConstruct } from "inversify";
import { FileUri } from '@theia/core/lib/node';
import { CliContribution } from '@theia/core/lib/node/cli';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { MessageService, ILogger } from '@theia/core';
import { WorkspaceServer } from "../common";
// import URI from '@theia/core/lib/common/uri';

@injectable()
export class WorkspaceCliContribution implements CliContribution {

    workspaceRoot = new Deferred<string | undefined>();

    configure(conf: yargs.Argv): void {
        conf.usage("$0 [workspace-directory] [options]");
        conf.option('root-dir', {
            description: 'DEPRECATED: Sets the workspace directory.',
        });
    }

    setArguments(args: yargs.Arguments): void {
        let wsPath = args._[2];
        if (!wsPath) {
            wsPath = args['root-dir'];
            if (!wsPath) {
                this.workspaceRoot.resolve();
                return;
            }
        }
        if (!path.isAbsolute(wsPath)) {
            const cwd = process.cwd();
            wsPath = path.join(cwd, wsPath);
        }
        this.workspaceRoot.resolve(wsPath);
    }
}

@injectable()
export class DefaultWorkspaceServer implements WorkspaceServer {

    protected root: Deferred<string | undefined> = new Deferred();

    @inject(WorkspaceCliContribution)
    protected readonly cliParams: WorkspaceCliContribution;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(ILogger)
    protected readonly logger: ILogger;

    @postConstruct()
    protected async init() {
        let root = await this.getRootURIFromCli();
        if (!root) {
            const data = await this.readFromUserHome();
            if (data && data.recentRoots) {
                root = data.recentRoots[0];
            }
        }
        this.root.resolve(root);
    }

    getRoot(): Promise<string | undefined> {
        return this.root.promise;
    }

    async setRoot(uri: string): Promise<void> {
        this.root = new Deferred();
        this.root.resolve(uri);
        this.writeToUserHome({
            recentRoots: [uri]
        });
    }

    protected async getRootURIFromCli(): Promise<string | undefined> {
        const arg = await this.cliParams.workspaceRoot.promise;
        return arg !== undefined ? FileUri.create(arg).toString() : undefined;
    }

    /**
     * Writes the given uri as the most recently used workspace root to the user's home directory.
     * @param uri most recently used uri
     */
    private async writeToUserHome(data: WorkspaceData): Promise<void> {
        const file = this.getUserStoragePath();
        if (!await fs.pathExists(file)) {
            await fs.mkdirs(path.resolve(file, '..'));
        }
        await fs.writeJson(file, data);
    }

    /**
     * Reads the most recently used workspace root from the user's home directory.
     */
    private async readFromUserHome(): Promise<WorkspaceData | undefined> {
        const file = this.getUserStoragePath();
        if (await fs.pathExists(file)) {
            const rawContent = await fs.readFile(file, 'utf-8');
            const content = rawContent.trim();
            if (!content) {
                return undefined;
            }

            let config;
            try {
                config = JSON.parse(content);
            } catch (error) {
                error.message = `${file}:\n${error.message}`;
                this.logger.warn('[CATCHED]', error);

                const FIX_FILE = 'Fix';
                const DELETE_FILE = 'Delete';
                const USER_MESSAGE = `Parse error in '${file}':\nFile will be ignored...`;
                this.messageService.warn(USER_MESSAGE, FIX_FILE, DELETE_FILE)
                    .then(async selected => {
                        // const uri = new URI(file);

                        if (selected === FIX_FILE) {
                            try {
                                // const opener = await this.openerService.getOpener(uri);
                                // await opener.open(uri);
                                this.messageService.info('Once fixed, you should reload the application.');

                            } catch (error) {
                                this.messageService.warn(`Cannot open '${file}'...`);
                                this.logger.warn(error);
                            }

                        } else if (selected === DELETE_FILE) {
                            fs.remove(file);
                        }
                    });

                return undefined;
            }

            if (WorkspaceData.is(config)) {
                return config;
            }
        }

        return undefined;
    }

    protected getUserStoragePath(): string {
        return path.resolve(os.homedir(), '.theia', 'recentworkspace.json');
    }

}

interface WorkspaceData {
    recentRoots: string[];
}

namespace WorkspaceData {
    // tslint:disable-next-line:no-any
    export function is(data: any): data is WorkspaceData {
        return data.recentRoots !== undefined;
    }
}
