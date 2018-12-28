export interface Message {
    type: 'NEW_REPORT' | 'DELETE_REPORT' | 'EDIT_REPORT' | 'NEW_REPORT_FOR_SUBSCRIPTION';
    data: NewReportData | EditReportData | DeleteReportData | SpecificSubscriptionReport;
}

export interface Report {
    id: number;
    reporter: User;
    tags: Tag[];
    reason: string;
    guildId?: string;
    links: string[];
    reportedUsers: User[];
    confirmationUsers: User[];
    insertDate: Date;
    updateDate: Date;
}

export interface SpecificSubscriptionReport {
    subscription?: number;
    attempt?: number;
}

export interface NewReportData extends SpecificSubscriptionReport{
    report: Report;
}

export interface EditReportData extends SpecificSubscriptionReport{
    id: number;
    report: Report;
}

export interface DeleteReportData extends SpecificSubscriptionReport{
    id: number;
}

export interface User {
    id: number;
    insertDate: Date;
}

export interface Tag {
    id: number;
    name: string;
    category: Category;
    insertDate: Date;
    updateDate: Date;
}

export interface Category {
    id: number;
    name: string;
    tags: Tag[];
    insertDate: Date;
    updateDate: Date;
}

export interface SearchResults {
    count: number;
    results: any[];
}

export interface SubscriptionSearchResults extends SearchResults {
    results: Subscription[];
}

export interface Subscription {
    id: number;
    consumer: Consumer;
    tags: Tag[];
    url: string;
    expectedResponseCode: number;
    discordWebhook: boolean;
}

export interface Consumer {
    id: number;
    name: string;
    description: string;
    permissions: number;
    subscriptions: Subscription[];
    insertDate: Date;
}
