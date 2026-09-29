import { fetchFromS3, putToS3 } from '../shared/s3Helper.js';

function guideKey(channelName) {
    return `admin/zelda-guides/${channelName}.json`;
}

/** Returns { summary, generatedAt, sourceMessageCount } or null if never generated. */
export async function getCachedGuide(channelName) {
    try {
        return await fetchFromS3(guideKey(channelName));
    } catch (err) {
        if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') return null;
        throw err;
    }
}

export async function saveGuide(channelName, { summary, sourceMessageCount }) {
    const guide = {
        summary,
        generatedAt: new Date().toISOString(),
        sourceMessageCount,
    };
    await putToS3(guideKey(channelName), JSON.stringify(guide, null, 2), 'application/json');
    return guide;
}
