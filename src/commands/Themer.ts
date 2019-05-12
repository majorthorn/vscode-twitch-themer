import * as vscode from 'vscode';
import ChatClient from '../chat/ChatClient';
import { ITheme } from './ITheme';
import { IListRecipient } from './IListRecipient';
import { Constants } from '../Constants';

/**
 * Manages all logic associated with retrieveing themes,
 * changing themes, etc.
 */
export class Themer {

    private _originalTheme: string | undefined;
    private _availableThemes: Array<ITheme> = [];
    private _listRecipients: Array<IListRecipient> = [];

    /**
     * constructor
     * @param _chatClient - Twitch chat client used in sending messages to users/chat
     */
    constructor(private _chatClient: ChatClient) 
    {
        /** 
         * Get the current theme so we can reset it later 
         * via command or when disconnecting from chat
         */
        this._originalTheme = vscode.workspace.getConfiguration().get('workbench.colorTheme');

        /**
         * Initialize the list of available themes for users
         */
        this.refreshThemes(Constants.chatClientUserName);
    }

    /**
     * Attempts to process commands received by users in Twitch chat
     * @param twitchUser - Username of person sending the command
     * @param command - Command sent by user
     * @param param - Optional additional parameters sent by user
     */
    public async handleCommands(twitchUser: string | undefined, command: string, param: string) {
        
        /** Only command we're going to respond to is !theme */
        if (command !== '!theme') {
            return;
        }
        
        param = param.toLowerCase().trim();

        let username: string  | undefined;
        /** Determine if the param is a (un)ban request */
        const ban = param.match(/((?:un)?ban) (\w*)/);
        if (ban) {
            param = ban[1] || ''; // Change the param to 'ban' or 'unban' 
            username = ban[2]; // The username to ban
        }

        switch (param) {
            case '':
                await this.currentTheme();
                break;
            case 'list':
                await this.sendThemes(twitchUser);
                break;
            case 'reset':
                await this.resetTheme();
                break;
            case 'random':
                await this.randomTheme(twitchUser);
                break;
            case 'refresh':
                await this.refreshThemes(twitchUser);
                break;
            case 'ban':
                await this.ban(twitchUser, username);
                break;
            case 'unban':
                await this.unban(twitchUser, username);
                break;
            default:
                this.changeTheme(twitchUser, param);
                break;
        }
    }

    /**
     * Retrieves an IListRecipient
     * @param twitchUser The user to retrieve from the list of recipients
     * @param banned (optional) Include only recipients that are banned
     */
    private getRecipient(twitchUser: string, banned?: boolean): IListRecipient | undefined {
        return this._listRecipients.filter(f => f.username.toLowerCase() === twitchUser.toLowerCase() && f.banned === banned)[0];
    }

    /**
     * Bans a user from using the themer plugin.
     * @param twitchUser The user requesting the ban
     * @param username The user to ban
     */
    private async ban(twitchUser: string | undefined, username: string | undefined) {
        if (twitchUser !== undefined && 
            twitchUser.toLowerCase() === Constants.chatClientUserName.toLowerCase() &&
            username !== undefined)  {
            const recipient = this.getRecipient(username);
            if (recipient === undefined) {
                this._listRecipients.push({username: username.toLowerCase(), banned: true});
                console.log(`${username} has been banned from using the themer plugin.`)
                // TODO: Add banned user to a json file.
            }
        }
    }

    /**
     * Unbans a user allowing them to use the themer plugin.
     * @param twitchUser The user requesting the unban
     * @param username The user to unban
     */
    private async unban(twitchUser: string | undefined, username: string | undefined) {
        if (twitchUser !== undefined && 
            twitchUser.toLowerCase() === Constants.chatClientUserName.toLowerCase() && 
            username !== undefined) {
            const recipient = this.getRecipient(username, true);
            if (recipient !== undefined) {
                const index = this._listRecipients.indexOf(recipient);
                recipient.banned = false;
                this._listRecipients.splice(index, 1, recipient);
                console.log(`${username} can now use the themer plugin.`)
                // TODO: Remove banned user from a json file.
            }
        }
    }

    /**
     * Send a whisper to the requesting user with a list of available themes
     * @param twitchUser - User that will receive whisper of available themes
     */
    private async sendThemes(twitchUser: string | undefined) {
        if (twitchUser !== undefined) {
            /** Ensure that we haven't sent them the list recently. */
            const lastSent = this.getRecipient(twitchUser);

            if (lastSent && lastSent.banned && lastSent.banned === true) {
                console.log(`${twitchUser} has been banned.`);
                return;
            }

            if (lastSent && lastSent.lastSent) {
                if (lastSent.lastSent.getDate() > ((new Date()).getDate() + -1)) {
                    return;
                } else {
                    lastSent.lastSent = new Date();
                }
            }
            else {
                this._listRecipients.push({username: twitchUser.toLowerCase(), lastSent: new Date()});
            }

            /** Get list of available themes and whisper them to user */
            const themeNames = this._availableThemes.map(m => m.label);
            this._chatClient.whisper(twitchUser, `Available themes are: ${themeNames.join(', ')}`);
        }
    }
    
    /**
     * Resets the theme to the one that was active when the extension was loaded
     */
    public async resetTheme() {
        if (this._originalTheme) {
            await this.changeTheme(undefined, this._originalTheme);
        }
    }

    /**
     * Refreshes the list of available themes
     * @param twitchUser - Username of user requesting to refresh the theme list
     */
    private async refreshThemes(twitchUser: string | undefined) {

        /** We only refresh the list of themes
         * if the requester was the logged in user
         */
        if (twitchUser &&
            twitchUser.toLowerCase().trim() === Constants.chatClientUserName.toLowerCase()) {
            vscode.extensions.all.filter(f => f.packageJSON.contributes &&
                                              f.packageJSON.contributes.themes &&
                                              f.packageJSON.contributes.themes.length > 0)
                            .forEach((fe: any) => {
                            const iThemes = fe.packageJSON.contributes.themes.map((m: any) => {
                                                            return { extensionId: fe.id, label: m.label, themeId: m.id };});
                                                            
                            this._availableThemes = (this._availableThemes.concat.apply(
                                                                        this._availableThemes,
                                                                        iThemes)
                                                                    .filter(() => true));
                            });

                            /** 
                            * The only reasons to refresh the list of themes is because 
                            * the user has added or removed theme extensions. Since the 
                            * list of available themes has changed we should allow users 
                            * to re-request the list of themes so they can continue playing. 
                            */
                            this.clearListRecipients();
        }
    } 

    /**
     * Changes the theme to a random option from all available themes
     * @param twitchUser - User who requested the random theme be applied
     */
    private async randomTheme(twitchUser: string | undefined) {
        const max = this._availableThemes.length;
        const randomNumber = Math.floor(Math.random() * max);
        const chosenTheme = this._availableThemes[randomNumber].label;
        await this.changeTheme(twitchUser, chosenTheme);
    }

    /**
     * Changes the active theme to the one specified
     * @param twitchUser - User who requested the theme be applied
     * @param themeName - Name of the theme to be applied
     */
    private async changeTheme(twitchUser: string | undefined, themeName: string) {
        
        /** Ensure the user hasn't been banned before changing the theme */
        if (twitchUser) {
            const recipient = this.getRecipient(twitchUser, true);
            if (recipient && recipient.banned && recipient.banned === true) {
                console.log(`${twitchUser} has been banned.`);
                return;
            }
        }

        /** Find theme based on themeName and change theme if it is found */
        const theme = this._availableThemes.filter(f => f.label.toLowerCase() === themeName.toLowerCase())[0];

        if (theme) {  
            const themeExtension = vscode.extensions.getExtension(theme.extensionId);
        
            if (themeExtension !== undefined) {
                const conf = vscode.workspace.getConfiguration();
                themeExtension.activate().then(f => { 
                    conf.update('workbench.colorTheme', theme.themeId || theme.label, vscode.ConfigurationTarget.Global);
                    if (twitchUser) {
                        vscode.window.showInformationMessage(`Theme changed to ${theme.label} by ${twitchUser}`);
                    }
                });
            }
        }
    }

    /**
     * Announces to chat the currently active theme
     */
    private async currentTheme() {
        const currentTheme = vscode.workspace.getConfiguration().get('workbench.colorTheme');
        this._chatClient.sendMessage(`The current theme is ${currentTheme}`);
    }

    /**
     * Clears the list of recipients so they can request the list of themes again
     */
    private clearListRecipients() {
        this._listRecipients = [];
    }
}
