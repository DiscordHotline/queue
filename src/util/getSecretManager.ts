import {Adapter as AWSAdapter} from '@secretary/aws-secrets-manager-adapter';
import {Manager} from '@secretary/core';
import {Adapter as JSONAdapter} from '@secretary/json-file-adapter';
import SecretsManager = require('aws-sdk/clients/secretsmanager');

const getSecretManager = (): Manager => {
    if (process.env.SECRETS_FILE) {
        return new Manager(new JSONAdapter({file: process.env.SECRETS_FILE}));
    }

    return new Manager(
        new AWSAdapter(
            new SecretsManager({
                region:      'us-east-1',
                credentials: {
                    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                },
            }),
        ),
    );
};

export default getSecretManager;
