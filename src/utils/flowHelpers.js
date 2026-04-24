const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// 特別單元對應表
const SEGMENTS = {
  robot: '機器人觀察週報',
  weekly: 'AI懶人精選週報'
};

const MAX_COVER_SIZE = 500 * 1024; // 500KB

async function compressImageForSoundOn(imagePath) {
  const stats = fs.statSync(imagePath);
  if (stats.size <= MAX_COVER_SIZE) {
    console.log(`   檔案大小 ${(stats.size / 1024).toFixed(0)}KB，無需壓縮`);
    return imagePath;
  }

  console.log(`   原始大小: ${(stats.size / 1024).toFixed(0)}KB，開始壓縮...`);
  const targetSize = 480 * 1024; // 留 20KB buffer
  const ratio = targetSize / stats.size;
  // 將壓縮比例映射到 quality (10-90)
  const estimatedQuality = Math.max(10, Math.min(90, Math.round(ratio * 90)));

  const ext = path.extname(imagePath);
  const outputPath = ext
    ? imagePath.replace(ext, '_compressed.jpg')
    : imagePath + '_compressed.jpg';

  await sharp(imagePath)
    .resize({ width: 1400, withoutEnlargement: true })
    .jpeg({ quality: estimatedQuality })
    .toFile(outputPath);

  const newStats = fs.statSync(outputPath);
  // 邊界情況：仍超過 500KB，用更低 quality 重壓
  if (newStats.size > MAX_COVER_SIZE) {
    const retryQuality = Math.max(10, Math.round(estimatedQuality * 0.6));
    await sharp(imagePath)
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: retryQuality })
      .toFile(outputPath);
    const finalStats = fs.statSync(outputPath);
    console.log(`   重新壓縮 (quality=${retryQuality}): ${(finalStats.size / 1024).toFixed(0)}KB`);
  } else {
    console.log(`   壓縮完成 (quality=${estimatedQuality}): ${(newStats.size / 1024).toFixed(0)}KB`);
  }

  return outputPath;
}

async function getNextEpisodeNumber(uploader) {
  try {
    console.log('🔍 正在分析現有單集列表...');

    // 嘗試從單集列表頁面解析EP編號，使用重試機制
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🌐 導航到單集管理頁面 (第 ${attempt} 次嘗試)...`);

        // 改進的頁面載入檢測 - 使用 domcontentloaded 替代 networkidle
        const pageLoadTimeout = parseInt(process.env.PAGE_LOAD_TIMEOUT) || 60000;
        await uploader.page.waitForLoadState('domcontentloaded', { timeout: pageLoadTimeout });
        console.log('✅ 基本頁面結構載入完成');

        // 等待一小段時間讓動態內容載入
        await uploader.page.waitForTimeout(2000);

        // 增強的單集管理連結選擇器
        const episodeManagementSelectors = [
          'a[href*="/episodes"]',
          'a[href*="單集"]',
          '.menu-item:has-text("單集")',
          '[data-testid*="episode"]',
          'nav a:has-text("單集")',
          '.ant-menu-item:has-text("單集")',
          'a:has-text("Episode")',
          'button:has-text("單集管理")'
        ];

        let navigationSuccess = false;

        // 嘗試點擊單集管理連結
        for (const selector of episodeManagementSelectors) {
          try {
            console.log(`🔍 嘗試選擇器: ${selector}`);
            const element = uploader.page.locator(selector);
            const count = await element.count();

            if (count > 0) {
              const elementWaitTimeout = parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 30000;
            const isVisible = await element.first().isVisible({ timeout: Math.min(elementWaitTimeout / 10, 3000) });
              if (isVisible) {
                await element.first().click();
                console.log(`✅ 成功點擊單集管理連結: ${selector}`);
                navigationSuccess = true;
                break;
              }
            }
          } catch (selectorError) {
            console.log(`⚠️ 選擇器失敗: ${selector}`);
            continue;
          }
        }

        // 如果無法透過連結導航，直接前往URL
        if (!navigationSuccess) {
          console.log('⚠️ 找不到單集管理連結，嘗試直接導航...');
          const navigationTimeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 60000;
          await uploader.page.goto('https://soundon.fm/app/podcasts/ca974d36-6fcc-46fc-a339-ba7ed8902c80/episodes', {
            waitUntil: 'domcontentloaded',
            timeout: navigationTimeout
          });

          // 等待頁面完全載入
          await uploader.page.waitForTimeout(3000);
        }

        // 等待單集列表載入，使用多種選擇器
        console.log('⏳ 等待單集列表載入...');
        const episodeListSelectors = [
          '.episode-title-link',
          '.ant-table-tbody tr',
          '[data-testid="episode-list"]',
          '.episode-item',
          'table tr td a',
          '.episode-row'
        ];

        let episodeListFound = false;
        const elementWaitTimeout = parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 30000;
        for (const selector of episodeListSelectors) {
          try {
            await uploader.page.waitForSelector(selector, { timeout: elementWaitTimeout });
            console.log(`✅ 單集列表載入完成 (使用選擇器: ${selector})`);
            episodeListFound = true;
            break;
          } catch (listError) {
            console.log(`⚠️ 選擇器未找到: ${selector}`);
            continue;
          }
        }

        if (!episodeListFound) {
          throw new Error('無法找到單集列表');
        }

        // 等待額外時間確保內容完全載入
        await uploader.page.waitForTimeout(2000);

        // 獲取所有單集標題，使用多種方法
        let episodeTitles = [];

        // 方法1: 標準的 episode-title-link
        try {
          episodeTitles = await uploader.page.evaluate(() => {
            const titleLinks = document.querySelectorAll('.episode-title-link');
            return Array.from(titleLinks).map(link => link.textContent.trim());
          });
        } catch (e) {
          console.log('⚠️ 方法1失敗，嘗試方法2...');
        }

        // 方法2: 表格中的連結
        if (episodeTitles.length === 0) {
          try {
            episodeTitles = await uploader.page.evaluate(() => {
              const tableLinks = document.querySelectorAll('table tr td a, .ant-table-tbody tr td a');
              return Array.from(tableLinks).map(link => link.textContent.trim()).filter(text => text.includes('EP'));
            });
          } catch (e) {
            console.log('⚠️ 方法2失敗，嘗試方法3...');
          }
        }

        // 方法3: 任何包含EP的文本
        if (episodeTitles.length === 0) {
          try {
            episodeTitles = await uploader.page.evaluate(() => {
              const allElements = document.querySelectorAll('*');
              const episodeTitles = [];
              for (const element of allElements) {
                const text = element.textContent?.trim();
                if (text && text.match(/^EP\d+/)) {
                  episodeTitles.push(text);
                }
              }
              return [...new Set(episodeTitles)]; // 去重
            });
          } catch (e) {
            console.log('⚠️ 方法3也失敗了');
          }
        }

        console.log(`📋 找到 ${episodeTitles.length} 個單集:`);
        episodeTitles.slice(0, 5).forEach((title, index) => {
          console.log(`   ${index + 1}. ${title}`);
        });

        // 解析EP編號
        const episodeNumbers = [];
        episodeTitles.forEach(title => {
          const match = title.match(/^EP(\d+)/);
          if (match) {
            const epNumber = parseInt(match[1]);
            episodeNumbers.push(epNumber);
          }
        });

        if (episodeNumbers.length > 0) {
          // 找出最大的EP編號
          const maxEpisodeNumber = Math.max(...episodeNumbers);
          const nextEpisodeNumber = maxEpisodeNumber + 1;

          console.log(`📊 找到的EP編號: ${episodeNumbers.sort((a, b) => b - a).slice(0, 5).join(', ')}...`);
          console.log(`🎯 最新集數: EP${maxEpisodeNumber}`);
          console.log(`🎯 下一集將是: EP${nextEpisodeNumber}`);

          return nextEpisodeNumber;
        } else {
          throw new Error('無法從標題中解析出EP編號');
        }

      } catch (parseError) {
        console.error(`❌ 第 ${attempt} 次嘗試失敗:`, parseError.message);

        if (attempt < 3) {
          const retryDelay = (parseInt(process.env.RETRY_DELAY_BASE) || 2000) * attempt;
          console.log(`⏳ 等待 ${retryDelay / 1000} 秒後重試...`);
          await uploader.page.waitForTimeout(retryDelay);
          continue;
        } else {
          console.log('⚠️ 所有嘗試都失敗，使用備用方案...');
          break;
        }
      }
    }

    // 備用方案：基於已知信息
    console.log('📊 基於HTML顯示，最新集數應該是 EP10');
    console.log('🎯 下一集將是: EP11');
    return 11;

  } catch (error) {
    console.error('❌ 獲取集數失敗:', error);
    console.log('⚠️ 無法判斷集數，將使用 EP11（基於截圖顯示的 EP10）');
    return 11;
  }
}

async function convertAudioToMp3(audioPath) {
  console.log('🔧 開始將音檔轉換為 MP3 格式...');

  const originalExt = path.extname(audioPath).toLowerCase();
  if (originalExt === '.mp3') {
    console.log('✅ 音檔已是 MP3 格式，跳過轉換');
    return audioPath;
  }

  let mp3Path;
  if (originalExt) {
    mp3Path = audioPath.replace(path.extname(audioPath), '.mp3');
  } else {
    mp3Path = audioPath + '.mp3';
  }
  const command = `ffmpeg -y -nostdin -i "${audioPath}" -codec:a libmp3lame -qscale:a 2 "${mp3Path}"`;

  try {
    await new Promise((resolve, reject) => {
      require('child_process').exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ FFmpeg 轉換失敗: ${error.message}`);
          console.error(`-- FFmpeg stderr: ${stderr}`);
          return reject(error);
        }
        console.log('✅ FFmpeg 轉換成功！');
        if (stdout) console.log(`-- FFmpeg stdout: ${stdout}`);
        resolve();
      });
    });

    console.log(`✅ 成功轉換音檔為 MP3: ${mp3Path}`);
    return mp3Path;
  } catch (error) {
    console.error('❌ 音檔轉換為 MP3 失敗:', error);
    throw error;
  }
}

// 組合 YouTube 影片描述（SoundOn 完整描述 + YouTube 專屬尾段）
function buildYouTubeDescription(soundOnDescription, tags) {
  // 清理描述：移除 markdown **粗體**、清除行首多餘空格
  const cleaned = soundOnDescription
    .replace(/\*\*/g, '')
    .split('\n')
    .map(line => line.replace(/^[\t ]+/, ''))
    .join('\n');

  // 從 tags 生成 hashtags（取前 15 個，去空格轉為 hashtag 格式）
  const hashtags = (tags || [])
    .slice(0, 15)
    .map(t => '#' + t.replace(/\s+/g, ''))
    .join(' ');

  return cleaned
    + '\n\n---'
    + '\n🎙️ AI懶人報 Podcast — 每日 AI 精華，幫你降低資訊焦慮'
    + '\n'
    + '\n📢 收聽更多平台：'
    + '\nApple Podcast / Spotify / KKBOX'
    + '\n👉 https://portaly.cc/ailrb'
    + '\n'
    + '\n💬 合作聯繫：ailanrenbao@gmail.com'
    + '\n'
    + '\n' + hashtags;
}

// 帶超時機制的標題選擇等待
async function waitForSelectionWithTimeout(titleServer, defaultIndex, timeoutMs) {
  return new Promise((resolve) => {
    let isResolved = false;

    // 設置超時
    const timeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve({
          index: defaultIndex,
          isTimeout: true,
          timestamp: new Date()
        });
      }
    }, timeoutMs);

    // 等待用戶選擇
    titleServer.waitForSelection().then((selectedData) => {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timeout);
        resolve({
          index: selectedData.index,
          isTimeout: false,
          timestamp: selectedData.timestamp
        });
      }
    });
  });
}

// // 業配文字 (舊)
// const APPENDED_TEXT = `🔥 《AI 懶人報》一週五更、16 萬人次、科技榜 #2 的自動化祕密公開！
// 想知道如何用 AI 打造一套能衝榜、還能接到 NordVPN 業配的「自動化內容產線」嗎？
// 我直接拆解了 104 個 n8n 節點流程與完整 Prompts，把這套獲利思維送給你。
// (內容包含：自動選題、台灣口音校對、業配自動插入、多路發布系統)
//
// 🎁 原價 NT. 5,990，現在限時 5 折優惠（NT. 2,990）：
// 👉 優惠連結：
// portaly.cc/ailrb/product/8HzQAVA7ZeGBaPb3LuJK
//
// `;

// // 業配文字 (BuildMoat)
// const APPENDED_TEXT = `🚀【懶人報專屬好康】現代系統設計實戰營：矽谷大咖帶你突破職涯瓶頸！
// 在 AI 時代，寫 Code 漂亮不再是唯一指標，「系統架構能力」才是面試大廠（Google、Meta、OpenAI）勝出的關鍵護城河！
//
// 這門課由兩位矽谷老將親自帶領：
// 🤖 Terry Chen（10 年矽谷經驗、50 萬訂閱 YouTuber）
// 🤖 Bohr Wang（曾任職於 OpenAI、Google、Meta 的主任工程師）
//
// 💡 你將學會：
// 👉 大廠實戰架構： 拆解 Spotify 排行榜、Tesla RoboTaxi、YouTube 等千萬級流量系統。
// 👉 不可替代性： 掌握 AI 無法代勞的決策力（資料庫選擇、高併發處理、架構省錢術）。
// 👉 最新 AI 應用： 實戰 RAG 智能系統與 MCP 協議 Agent 架構。
//
// 🔥懶人報聽眾限定：超過 5 折超狂優惠！
// 現在點擊下方連結結帳，直接享有專屬「半價以上」折扣，投資自己職涯的最高槓桿：
// 👉 專屬優惠連結：
// https://www.buildmoat.org/?promo_code=promo_1TIqotIXmUwiEgU6tciLjSiI
//
// `;

// // 業配文字 (AI Podcast 自動化流程)
// const APPENDED_TEXT = `🚀 【限時優惠】從每集 6 小時縮短至 20 分鐘的播客祕訣！
// 想做到一週五更、衝上科技榜前三名嗎？這套「AI Podcast 自動化流程 V2.0」幫我創造了 20 萬次下載，現在正式公開！從自動選題、在地化講稿到語音生成，讓你告別重複勞動。
// 🔥 原價 NT$5,990 ➡️ 限時優惠只要 NT$3,290
// 點擊加入自動化行列：https://portaly.cc/ailrb/product/8HzQAVA7ZeGBaPb3LuJK
//
// `;

// 業配文字
const APPENDED_TEXT = `【 🎙️ AI 懶人報自動化流程 】

好奇這個節目是怎麼用 AI 自動化做到一週五更的嗎？我把完整的自動化流程公開了——包含 104 個 n8n 節點、完整 Prompts 與系統架構（自動選題、台灣口音校對、多平台發布），有興趣的朋友歡迎參考！

👉 了解更多：https://portaly.cc/ailrb/product/8HzQAVA7ZeGBaPb3LuJK

`;

const APPENDED_TEXT2 = `

    歡迎請我喝杯咖啡，幫助我繼續把節目做得更好唷～！
    👉 https://buymeacoffee.com/ailanrenbao
    `;

module.exports = {
  SEGMENTS,
  MAX_COVER_SIZE,
  APPENDED_TEXT,
  APPENDED_TEXT2,
  compressImageForSoundOn,
  getNextEpisodeNumber,
  convertAudioToMp3,
  buildYouTubeDescription,
  waitForSelectionWithTimeout
};
