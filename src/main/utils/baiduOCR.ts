import fetch from "node-fetch";

// 默认为空，由用户配置
let API_KEY = "";
let SECRET_KEY = "";

// 设置API密钥
export function setBaiduKeys(apiKey: string, secretKey: string) {
    API_KEY = apiKey;
    SECRET_KEY = secretKey;
}

// 获取access_token
async function getAccessToken() {
    if (!API_KEY || !SECRET_KEY) {
        throw new Error("请先配置百度OCR的API Key和Secret Key");
    }

    const res = await fetch(
        `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`,
        { method: "POST" }
    );
    const data = await res.json();

    if (data.error) {
        throw new Error(`获取access_token失败: ${data.error_description || data.error}`);
    }

    return data.access_token;
}

// 通用文字识别（标准版）
export async function baiduOcrImage(imageBase64: string): Promise<string> {
    const accessToken = await getAccessToken();
    const res = await fetch(
        `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${accessToken}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `image=${encodeURIComponent(imageBase64)}`,
        }
    );
    const data = await res.json();
    if (data.words_result) {
        return data.words_result.map((item: any) => item.words).join("\n");
    }
    return data.error_msg || "识别失败";
}

// 通用文字识别（高精度版）
export async function baiduOcrAccurate(imageBase64: string): Promise<string> {
    const accessToken = await getAccessToken();
    const res = await fetch(
        `https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic?access_token=${accessToken}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `image=${encodeURIComponent(imageBase64)}`,
        }
    );
    const data = await res.json();
    if (data.words_result) {
        return data.words_result.map((item: any) => item.words).join("\n");
    }
    return data.error_msg || "识别失败";
}

// 网络图片文字识别
export async function baiduOcrWebImage(imageUrl: string): Promise<string> {
    const accessToken = await getAccessToken();
    const res = await fetch(
        `https://aip.baidubce.com/rest/2.0/ocr/v1/webimage?access_token=${accessToken}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `url=${encodeURIComponent(imageUrl)}`,
        }
    );
    const data = await res.json();
    if (data.words_result) {
        return data.words_result.map((item: any) => item.words).join("\n");
    }
    return data.error_msg || "识别失败";
} 