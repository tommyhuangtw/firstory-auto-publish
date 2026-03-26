require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const https = require('https');

class KieAiService {
  constructor() {
    this.apiKey = process.env.KIE_AI_API_KEY;
    this.baseUrl = 'https://api.kie.ai';
    if (!this.apiKey) {
      throw new Error('請在 .env 檔案中設定 KIE_AI_API_KEY');
    }
  }

  async _request(method, endpoint, body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`Kie.ai API 錯誤: ${data.message || JSON.stringify(data)}`);
    }
    return data;
  }

  /**
   * 使用 Ideogram v3 文字轉圖片生成縮圖
   */
  async generateThumbnailWithIdeogram(prompt, options = {}) {
    console.log('🎨 [Kie.ai] 使用 Ideogram v3 生成縮圖...');

    const body = {
      model: 'ideogram/v3-text-to-image',
      input: {
        prompt,
        rendering_speed: options.renderingSpeed || 'BALANCED',
        style: options.style || 'DESIGN',
        expand_prompt: options.expandPrompt !== undefined ? options.expandPrompt : true,
        image_size: 'landscape_16_9', // YouTube 縮圖比例
        negative_prompt: options.negativePrompt || 'blurry, ugly, low quality, watermark'
      }
    };

    if (options.seed) {
      body.input.seed = options.seed;
    }

    const result = await this._request('POST', '/api/v1/jobs/createTask', body);
    console.log(`✅ [Kie.ai] Ideogram 任務已建立: ${result.data.taskId}`);
    return result.data.taskId;
  }

  /**
   * 使用 Qwen Image Edit 基於現有封面生成縮圖
   */
  async generateThumbnailWithQwen(prompt, imageUrl, options = {}) {
    console.log('🎨 [Kie.ai] 使用 Qwen Image Edit 生成縮圖...');

    const body = {
      model: 'qwen/image-edit',
      input: {
        prompt,
        image_url: imageUrl,
        acceleration: options.acceleration || 'none',
        image_size: 'landscape_16_9', // YouTube 縮圖比例
        num_inference_steps: options.steps || 30,
        guidance_scale: options.guidanceScale || 4,
        sync_mode: false,
        enable_safety_checker: true,
        output_format: 'png',
        negative_prompt: options.negativePrompt || 'blurry, ugly, low quality'
      }
    };

    if (options.seed) {
      body.input.seed = options.seed;
    }

    const result = await this._request('POST', '/api/v1/jobs/createTask', body);
    console.log(`✅ [Kie.ai] Qwen 任務已建立: ${result.data.taskId}`);
    return result.data.taskId;
  }

  /**
   * 查詢任務狀態
   */
  async queryTask(taskId) {
    const result = await this._request('GET', `/api/v1/jobs/recordInfo?taskId=${taskId}`);
    return result.data;
  }

  /**
   * 等待任務完成並返回結果圖片 URL
   */
  async waitForTask(taskId, maxWaitMs = 120000) {
    console.log(`⏳ [Kie.ai] 等待任務完成: ${taskId}`);
    const startTime = Date.now();
    const pollInterval = 3000; // 每 3 秒輪詢一次

    while (Date.now() - startTime < maxWaitMs) {
      const task = await this.queryTask(taskId);

      if (task.state === 'success') {
        const resultData = JSON.parse(task.resultJson);
        const imageUrls = resultData.resultUrls;
        console.log(`✅ [Kie.ai] 任務完成，生成了 ${imageUrls.length} 張圖片`);
        return imageUrls;
      }

      if (task.state === 'fail') {
        throw new Error(`Kie.ai 任務失敗: ${task.failMsg || '未知錯誤'}`);
      }

      console.log(`   狀態: ${task.state}，繼續等待...`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Kie.ai 任務超時 (${maxWaitMs / 1000}秒)`);
  }

  /**
   * 下載圖片到本地
   */
  async downloadImage(imageUrl, outputPath) {
    console.log(`⬇️ [Kie.ai] 下載圖片: ${path.basename(outputPath)}`);

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`下載圖片失敗: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, buffer);

    console.log(`✅ [Kie.ai] 圖片已儲存: ${outputPath}`);
    return outputPath;
  }

  /**
   * 生成 YouTube 縮圖 - 使用 Ideogram（純文字生成）
   * @param {string} title - 集數標題（如 "EP15 - AI 工具大革命"）
   * @param {number} episodeNumber - 集數編號
   * @returns {string} 本地圖片路徑
   */
  async generateIdeogramThumbnail(title, episodeNumber) {
    const prompt = `A professional YouTube podcast thumbnail design.
Background: modern tech-style gradient (dark blue to purple), with subtle circuit board patterns and glowing nodes.
Center: Bold, large Traditional Chinese text "${title}" in white with golden glow effect, clearly readable.
Top-left corner: "AI懶人報" logo text in a stylish badge.
Bottom-right: Episode number "EP${episodeNumber}" in a modern rounded badge.
Style: Clean, professional podcast branding. High contrast for readability. YouTube thumbnail optimized.
The text must be perfectly rendered in Traditional Chinese characters.`;

    const taskId = await this.generateThumbnailWithIdeogram(prompt, {
      style: 'DESIGN',
      renderingSpeed: 'QUALITY'
    });

    const imageUrls = await this.waitForTask(taskId);

    const outputPath = path.join(__dirname, '../../temp', `thumbnail_ideogram_ep${episodeNumber}.png`);
    await this.downloadImage(imageUrls[0], outputPath);

    return outputPath;
  }

  /**
   * 生成 YouTube 縮圖 - 使用 Qwen（基於封面圖編輯）
   * @param {string} title - 集數標題
   * @param {number} episodeNumber - 集數編號
   * @param {string} coverImageUrl - 封面圖片的公開 URL
   * @returns {string} 本地圖片路徑
   */
  async generateQwenThumbnail(title, episodeNumber, coverImageUrl) {
    const prompt = `Transform this podcast cover image into a YouTube thumbnail.
Keep the original design elements but adapt to 16:9 landscape format.
Add large, bold Traditional Chinese title text "${title}" overlaid on the image.
Add "EP${episodeNumber}" badge in the corner.
Make it eye-catching and clickable for YouTube.
Ensure all Chinese text is perfectly readable and properly rendered.
Add a subtle gradient overlay for text readability.`;

    const taskId = await this.generateThumbnailWithQwen(prompt, coverImageUrl, {
      acceleration: 'none',
      steps: 30,
      guidanceScale: 5
    });

    const imageUrls = await this.waitForTask(taskId);

    const outputPath = path.join(__dirname, '../../temp', `thumbnail_qwen_ep${episodeNumber}.png`);
    await this.downloadImage(imageUrls[0], outputPath);

    return outputPath;
  }

  /**
   * 同時用兩種方式生成縮圖，讓用戶選擇
   */
  async generateAllThumbnailOptions(title, episodeNumber, coverImageUrl = null) {
    const results = [];

    // 方案 1: Ideogram 純生成
    console.log('\n📸 方案 A: Ideogram v3 文字轉圖片');
    try {
      const ideogramPath = await this.generateIdeogramThumbnail(title, episodeNumber);
      results.push({ method: 'ideogram', path: ideogramPath, label: 'Ideogram v3 (AI 全新生成)' });
    } catch (error) {
      console.error('❌ Ideogram 生成失敗:', error.message);
    }

    // 方案 2: Qwen 封面編輯（需要封面圖 URL）
    if (coverImageUrl) {
      console.log('\n📸 方案 B: Qwen Image Edit (基於封面圖)');
      try {
        const qwenPath = await this.generateQwenThumbnail(title, episodeNumber, coverImageUrl);
        results.push({ method: 'qwen', path: qwenPath, label: 'Qwen (基於封面圖編輯)' });
      } catch (error) {
        console.error('❌ Qwen 生成失敗:', error.message);
      }
    }

    return results;
  }
}

module.exports = { KieAiService };
