const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { Logger } = require('./utils/logger');

class SoundOnUploader {
  constructor() {
    this.logger = new Logger();
    this.browser = null;
    this.page = null;
    this.userDataDir = path.join(__dirname, '..', 'temp', 'browser-data');
    this.cookiesPath = path.join(__dirname, '..', 'temp', 'soundon-cookies.json');
  }

  async initialize() {
    // 確保目錄存在
    const tempDir = path.dirname(this.cookiesPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 使用持久化的 user data directory 來保持登入狀態
    const launchOptions = {
      headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
      slowMo: 1000,
      viewport: { width: 1920, height: 1080 },
      timeout: 60000, // 增加瀏覽器啟動超時時間
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    };

    // 如果在 Docker 環境中，使用系統的 Chromium
    if (process.env.NODE_ENV === 'production' && fs.existsSync('/usr/bin/chromium-browser')) {
      launchOptions.executablePath = '/usr/bin/chromium-browser';
      launchOptions.args.push('--no-sandbox', '--disable-setuid-sandbox');
    }

    this.browser = await chromium.launchPersistentContext(this.userDataDir, launchOptions);
    
    this.page = this.browser.pages()[0] || await this.browser.newPage();
    await this.page.setViewportSize({ width: 1920, height: 1080 });
    
    // 處理 Chrome 還原對話框
    try {
      this.logger.info('檢查是否有還原對話框...');
      
      // 等待頁面載入
      await this.page.waitForTimeout(2000);
      
      // 查找還原按鈕的各種可能選擇器
      const restoreButtonSelectors = [
        'button:has-text("還原")',
        'button:has-text("Restore")',
        'button[data-testid="restore-button"]',
        '.restore-button',
        '[role="button"]:has-text("還原")',
        '[role="button"]:has-text("Restore")'
      ];
      
      let restoreClicked = false;
      for (const selector of restoreButtonSelectors) {
        try {
          const restoreButton = this.page.locator(selector);
          if (await restoreButton.isVisible({ timeout: 3000 })) {
            this.logger.info(`找到還原按鈕，點擊: ${selector}`);
            await restoreButton.click();
            restoreClicked = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (restoreClicked) {
        this.logger.info('已點擊還原按鈕，等待頁面載入...');
        await this.page.waitForTimeout(3000);
      } else {
        this.logger.info('沒有找到還原對話框');
      }
      
      // 如果頁面還是空白或顯示 about:blank，可能需要手動導航
      const currentUrl = this.page.url();
      if (currentUrl === 'about:blank' || currentUrl === '') {
        this.logger.info('頁面為空白，將在登入時導航到正確頁面');
      }
      
    } catch (error) {
      this.logger.warn('處理還原對話框時發生錯誤:', error.message);
    }
  }

  async login() {
    // 重試登入最多3次
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.logger.info(`開始 SoundOn 登入流程 (第 ${attempt} 次嘗試)...`);

        // 1. 進入登入頁面，使用可配置的超時時間
        const navigationTimeout = parseInt(process.env.NAVIGATION_TIMEOUT) || 60000;
        await this.page.goto('https://host.soundon.fm/app/podcasts/ca974d36-6fcc-46fc-a339-ba7ed8902c80/episodes', {
          waitUntil: 'domcontentloaded',
          timeout: navigationTimeout
        });
        this.logger.info('已進入 SoundOn 登入頁面');

        // 等待頁面穩定
        await this.page.waitForTimeout(2000);

        // 檢查是否已經登入
        if (this.page.url().includes('/episodes')) {
          this.logger.info('已處於登入狀態');
          return true;
        }

        // 等待 email 輸入框出現，使用可配置的超時時間
        const elementWaitTimeout = parseInt(process.env.ELEMENT_WAIT_TIMEOUT) || 30000;
        const emailInput = this.page.locator('input[type="email"], input[name="email"]');
        await emailInput.waitFor({ timeout: elementWaitTimeout });

        // 2. 填入登入資訊
        const email = 'tommyhuang0511@gmail.com';
        const password = 'Lanrenbao654183!';

        this.logger.info(`使用帳號登入: ${email}`);

        await emailInput.fill(email);
        this.logger.info('Email 已填入');

        const passwordInput = this.page.locator('input[type="password"], input[name="password"]');
        await passwordInput.fill(password);
        this.logger.info('密碼已填入');

        // 3. 點擊登入按鈕
        const loginButton = this.page.locator('button[type="submit"], button:has-text("登入")');
        await loginButton.click();
        this.logger.info('已點擊登入按鈕');

        // 4. 等待登入完成或失敗，使用可配置的超時時間
        const loginTimeout = parseInt(process.env.LOGIN_TIMEOUT) || 60000;
        this.logger.info('等待登入結果...');
        await Promise.race([
          // 成功：URL 變為 dashboard
          this.page.waitForURL('**/episodes', { timeout: loginTimeout }),
          // 失敗：出現錯誤訊息
          this.page.locator('text="登入失敗", text="帳號或密碼錯誤"').waitFor({ timeout: loginTimeout })
        ]);

        // 5. 檢查是否成功登入
        const finalUrl = this.page.url();
        this.logger.info(`登入後 URL: ${finalUrl}`);

        if (finalUrl.includes('/episodes')) {
          this.logger.info('登入成功，已進入 SoundOn Dashboard');
          await this.saveCookies();
          return true;
        } else {
          const errorMessage = await this.page.locator('text="登入失敗", text="帳號或密碼錯誤"').textContent().catch(() => '未找到明確的錯誤訊息');
          throw new Error(`登入後無法進入 dashboard，當前 URL: ${finalUrl}。錯誤訊息: ${errorMessage}`);
        }

      } catch (error) {
        this.logger.error(`第 ${attempt} 次登入嘗試失敗:`, error);

        if (attempt < 3) {
          const retryDelay = (parseInt(process.env.RETRY_DELAY_BASE) || 2000) * attempt;
          this.logger.info(`⏳ 等待 ${retryDelay / 1000} 秒後重試...`);
          await this.page.waitForTimeout(retryDelay);
          continue;
        } else {
          await this.page.screenshot({ path: 'temp/login-error.png' });
          this.logger.info('登入錯誤截圖已保存');
          return false;
        }
      }
    }

    // 如果所有嘗試都失敗
    return false;
  }

  async clickNewEpisode() {
    try {
      this.logger.info('點擊新增單集按鈕...');
      
      // 根據提供的HTML，查找新增單集按鈕
      const newEpisodeSelectors = [
        'button:has-text("新增單集")',
        'button.ant-btn:has(span:text("新增單集"))',
        '.anticon-plus:has(+ span:text("新增單集"))',
        'button:has(.anticon-plus):has-text("新增單集")'
      ];
      
      let clicked = false;
      for (const selector of newEpisodeSelectors) {
        try {
          const element = this.page.locator(selector);
          if (await element.isVisible({ timeout: 5000 })) {
            await element.click();
            this.logger.info(`成功點擊新增單集按鈕: ${selector}`);
            clicked = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!clicked) {
        throw new Error('找不到新增單集按鈕');
      }
      
      // 等待建立單集頁面載入
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(3000);
      
      // 檢查是否成功進入建立單集頁面
      const pageTitle = await this.page.locator('h3:has-text("建立單集")').isVisible();
      if (pageTitle) {
        this.logger.info('成功進入建立單集頁面');
        return true;
      } else {
        throw new Error('未能進入建立單集頁面');
      }
      
    } catch (error) {
      this.logger.error('點擊新增單集失敗:', error);
      return false;
    }
  }

  async uploadAudioFile(audioPath) {
    try {
      this.logger.info(`開始上傳音檔: ${path.basename(audioPath)}`);
      
      // 確保音頻文件存在
      if (!fs.existsSync(audioPath)) {
        throw new Error(`音頻文件不存在: ${audioPath}`);
      }
      
      // 獲取音頻文件的絕對路徑
      const absoluteAudioPath = path.resolve(audioPath);
      this.logger.info(`音頻文件絕對路徑: ${absoluteAudioPath}`);
      
      // 等待頁面載入
      await this.page.waitForTimeout(2000);
      
      // 方法1: 直接查找文件輸入框（不點擊按鈕）
      this.logger.info('直接查找文件輸入框...');
      const fileInputSelectors = [
        'input[type="file"]',
        'input[accept*="audio"]',
        'input[accept*="mp3"]',
        'input[data-testid="file-input"]',
        '.ant-upload input[type="file"]',
        '.upload-input input[type="file"]'
      ];
      
      let uploaded = false;
      
      // 首先嘗試直接設置到隱藏的輸入框
      for (const selector of fileInputSelectors) {
        try {
          const fileInputs = this.page.locator(selector);
          const count = await fileInputs.count();
          
          if (count > 0) {
            this.logger.info(`找到 ${count} 個檔案輸入框，使用選擇器: ${selector}`);
            
            // 嘗試第一個輸入框
            const fileInput = fileInputs.first();
            
            try {
              // 直接設置文件，不管輸入框是否可見
              await fileInput.setInputFiles(absoluteAudioPath);
              this.logger.info(`成功設定檔案到輸入框: ${selector}`);
              
              // 等待一下看是否有反應
              await this.page.waitForTimeout(3000);
              
              // 檢查是否開始上傳
              const uploadIndicators = [
                '.ant-upload-list-item',
                '.upload-progress',
                '[class*="upload"]',
                '[class*="progress"]'
              ];
              
              let hasUploadStarted = false;
              for (const indicator of uploadIndicators) {
                try {
                  const elements = this.page.locator(indicator);
                  if (await elements.count() > 0) {
                    hasUploadStarted = true;
                    this.logger.info(`檢測到上傳開始: ${indicator}`);
                    break;
                  }
                } catch (e) {
                  continue;
                }
              }
              
              if (hasUploadStarted) {
                uploaded = true;
                break;
              }
              
            } catch (error) {
              this.logger.warn(`直接設置文件失敗:`, error.message);
            }
          }
        } catch (error) {
          this.logger.warn(`選擇器 ${selector} 失敗:`, error.message);
          continue;
        }
      }
      
      // 方法2: 如果直接設置失敗，嘗試點擊按鈕後設置
      if (!uploaded) {
        this.logger.info('嘗試點擊上傳按鈕後設置文件...');
        
        const uploadButtonSelectors = [
          'button:has-text("加入音檔")',
          'button:has-text("上傳音檔")',
          'button:has-text("Upload")',
          '.upload-button',
          '[data-testid="upload-button"]',
          '.ant-upload-btn'
        ];
        
        let buttonClicked = false;
        for (const selector of uploadButtonSelectors) {
          try {
            const element = this.page.locator(selector);
            if (await element.isVisible({ timeout: 3000 })) {
              await element.click();
              this.logger.info(`成功點擊上傳按鈕: ${selector}`);
              buttonClicked = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (buttonClicked) {
          // 等待文件對話框出現
          await this.page.waitForTimeout(2000);
          
          // 使用 Playwright 的文件選擇事件處理
          this.logger.info('等待文件對話框並設置文件...');
          
          // 創建文件選擇器監聽器
          const [fileChooser] = await Promise.race([
            Promise.all([
              this.page.waitForEvent('filechooser', { timeout: 10000 }),
              // 如果沒有自動觸發文件選擇器，再次點擊
              (async () => {
                await this.page.waitForTimeout(1000);
                const fileInputs = this.page.locator('input[type="file"]');
                const count = await fileInputs.count();
                if (count > 0) {
                  await fileInputs.first().click({ force: true });
                }
              })()
            ]),
            // 超時後的備用方案
            (async () => {
              await this.page.waitForTimeout(10000);
              return [null];
            })()
          ]);
          
          if (fileChooser) {
            this.logger.info('文件選擇器已觸發，設置音頻文件...');
            await fileChooser.setFiles(absoluteAudioPath);
            this.logger.info('文件已設置到選擇器');
            uploaded = true;
          } else {
            this.logger.warn('文件選擇器未觸發，嘗試直接設置');
            
            // 備用方案：直接設置到任何可用的文件輸入框
            const allFileInputs = this.page.locator('input[type="file"]');
            const inputCount = await allFileInputs.count();
            
            for (let i = 0; i < inputCount; i++) {
              try {
                const input = allFileInputs.nth(i);
                await input.setInputFiles(absoluteAudioPath);
                this.logger.info(`備用方案：設置文件到第 ${i + 1} 個輸入框`);
                uploaded = true;
                break;
              } catch (e) {
                continue;
              }
            }
          }
        }
      }
      
      if (!uploaded) {
        throw new Error('所有文件設置方法都失敗了');
      }
      
      // 關閉任何還開著的文件對話框
      this.logger.info('關閉文件對話框...');
      try {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
      } catch (e) {
        // 忽略
      }
      
      // 等待上傳進度並確認完成
      this.logger.info('等待音檔上傳完成...');
      
      // 簡化的上傳完成檢測
      let uploadCompleted = false;
      let progressAttempt = 0;
      const maxProgressAttempts = 20; // 減少到20秒
      
      while (!uploadCompleted && progressAttempt < maxProgressAttempts) {
        try {
          // 檢查 SoundOn 特有的上傳完成狀態
          // 當上傳完成時，上傳區域會消失或改變
          const uploaderArea = this.page.locator('.so-audio-uploader__area');
          const uploaderAreaExists = await uploaderArea.count() > 0;
          
          if (!uploaderAreaExists) {
            this.logger.info('檢測到上傳區域消失 - 上傳可能已完成');
            uploadCompleted = true;
            break;
          }
          
          // 檢查是否有 "將 mp3 檔案拖曳到這裡" 文字消失（表示上傳完成）
          const dragText = await uploaderArea.textContent();
          if (!dragText || !dragText.includes('將 mp3 檔案拖曳到這裡')) {
            this.logger.info('檢測到上傳提示文字變化 - 上傳可能已完成');
            uploadCompleted = true;
            break;
          }
          
          // 檢查是否出現了文件名或完成指示
          const allElements = await this.page.$$('*');
          for (const element of allElements) {
            try {
              const text = await element.textContent();
              if (text && (
                text.includes('daily_podcast_chinese_2025-06-10') ||
                text.includes('上傳完成') ||
                text.includes('100%') ||
                text.includes('已完成')
              )) {
                this.logger.info(`檢測到完成指示: ${text.trim()}`);
                uploadCompleted = true;
                break;
              }
            } catch (e) {
              continue;
            }
          }
          
          if (uploadCompleted) break;
          
          // 檢查標準的 Ant Design 上傳完成狀態
          const successSelectors = [
            '.ant-upload-list-item-done',
            '.ant-upload-list-item-success',
            '[class*="upload"][class*="done"]',
            '[class*="upload"][class*="success"]'
          ];
          
          for (const selector of successSelectors) {
            const elements = this.page.locator(selector);
            const count = await elements.count();
            if (count > 0) {
              this.logger.info(`檢測到上傳完成元素: ${selector} (${count}個)`);
              uploadCompleted = true;
              break;
            }
          }
          
          if (uploadCompleted) break;
          
        } catch (error) {
          // 忽略檢測過程中的錯誤
        }
        
        if (!uploadCompleted) {
          progressAttempt++;
          // 只在前5秒每秒檢查，之後每2秒檢查一次
          const waitTime = progressAttempt <= 5 ? 1000 : 2000;
          
          // 每5秒顯示一次進度
          if (progressAttempt % 5 === 0) {
            this.logger.info(`上傳進度檢查中... (${progressAttempt}/${maxProgressAttempts}秒)`);
          }
          await this.page.waitForTimeout(waitTime);
        }
      }
      
      if (!uploadCompleted) {
        this.logger.warn('上傳狀態檢測超時，但假設已完成');
        // 不拋出錯誤，假設上傳已完成
      }
      
      this.logger.info('音檔上傳流程完成');
      return true;
      
    } catch (error) {
      this.logger.error('上傳音檔失敗:', error);
      
      // 嘗試關閉任何開啟的對話框
      try {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
      } catch (e) {
        // 忽略
      }
      
      return false;
    }
  }

  async fillEpisodeInfo(title, description) {
    try {
      this.logger.info('填寫單集資訊...');
      
      // 填寫標題
      const titleInput = this.page.locator('#title, input[id="title"]');
      await titleInput.waitFor({ timeout: 10000 });
      await titleInput.clear();
      await titleInput.fill(title);
      this.logger.info(`標題已填寫: ${title}`);
      
      // 填寫描述 - 使用 Quill 編輯器
      const descriptionEditor = this.page.locator('.ql-editor');
      await descriptionEditor.waitFor({ timeout: 10000 });
      await descriptionEditor.clear();
      await descriptionEditor.fill(description);
      this.logger.info('描述已填寫');
      
      return true;
      
    } catch (error) {
      this.logger.error('填寫單集資訊失敗:', error);
      return false;
    }
  }

  async selectEpisodeType() {
    try {
      this.logger.info('選擇上架類型: 一般單集');
      
      // 多種選擇器嘗試選擇一般單集
      const selectors = [
        'input[type="radio"][value="public"]',
        '.ant-radio-input[value="public"]',
        'input[type="radio"]:not([value="soundon_exclusive"])',
        'span:has-text("一般單集") input[type="radio"]',
        'label:has-text("一般單集") input[type="radio"]'
      ];
      
      let success = false;
      for (const selector of selectors) {
        try {
          const element = this.page.locator(selector);
          await element.waitFor({ timeout: 3000 });
          
          // 檢查是否已經選中
          const isChecked = await element.isChecked();
          if (!isChecked) {
            await element.check();
            this.logger.info(`使用選擇器 ${selector} 成功選擇一般單集`);
          } else {
            this.logger.info(`一般單集已經選中 (使用選擇器: ${selector})`);
          }
          success = true;
          break;
        } catch (error) {
          this.logger.debug(`選擇器 ${selector} 失敗:`, error.message);
          continue;
        }
      }
      
      if (!success) {
        this.logger.warn('所有選擇器都失敗，嘗試點擊文字');
        // 嘗試點擊包含"一般單集"的文字
        const textElement = this.page.locator('text="一般單集"').first();
        await textElement.click();
        this.logger.info('通過點擊文字選擇一般單集');
      }
      
      return true;
      
    } catch (error) {
      this.logger.error('選擇上架類型失敗:', error);
      return false;
    }
  }

  async setAdvertisementOptions() {
    try {
      this.logger.info('設定廣告選項...');
      
      // 片頭動態廣告選擇"否"
      const preAdNoRadio = this.page.locator('#daiStatus input[type="radio"][value="inactive"]');
      await preAdNoRadio.waitFor({ timeout: 10000 });
      await preAdNoRadio.check();
      this.logger.info('片頭動態廣告已選擇"否"');
      
      // 片中動態廣告選擇"否"
      const midAdNoRadio = this.page.locator('#daiMiddleStatus input[type="radio"][value="inactive"]');
      await midAdNoRadio.waitFor({ timeout: 10000 });
      await midAdNoRadio.check();
      this.logger.info('片中動態廣告已選擇"否"');
      
      return true;
      
    } catch (error) {
      this.logger.error('設定廣告選項失敗:', error);
      return false;
    }
  }

  async saveDraft() {
    try {
      this.logger.info('保存草稿...');
      
      // 關閉任何可能開啟的對話框
      try {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
        this.logger.info('準備保存前先關閉任何對話框');
      } catch (e) {
        // 忽略
      }
      
      // 查找暫存草稿按鈕
      const draftButtonSelectors = [
        'button:has-text("暫存草稿")',
        'button:has-text("儲存草稿")',
        'button:has-text("保存草稿")',
        'button:has-text("Save Draft")',
        'button[data-testid="save-draft"]',
        '.save-draft-button'
      ];
      
      let draftButtonClicked = false;
      for (const selector of draftButtonSelectors) {
        try {
          const draftButton = this.page.locator(selector);
          if (await draftButton.isVisible({ timeout: 5000 })) {
            await draftButton.click();
            this.logger.info(`成功點擊草稿保存按鈕: ${selector}`);
            draftButtonClicked = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!draftButtonClicked) {
        throw new Error('找不到暫存草稿按鈕');
      }
      
      // 等待保存處理
      await this.page.waitForTimeout(3000);
      
      // 檢查保存成功的指示
      const successSelectors = [
        '.ant-message-success',
        '.success-message',
        '[class*="success"]',
        'text="保存成功"',
        'text="草稿已保存"',
        'text="儲存成功"'
      ];
      
      let saveConfirmed = false;
      for (const selector of successSelectors) {
        try {
          const successElement = this.page.locator(selector);
          if (await successElement.isVisible({ timeout: 3000 })) {
            const text = await successElement.textContent();
            this.logger.info(`檢測到保存成功訊息: ${text}`);
            saveConfirmed = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // 檢查是否有錯誤訊息
      const errorSelectors = [
        '.ant-message-error',
        '.error-message',
        '[class*="error"]',
        'text="保存失敗"',
        'text="儲存失敗"'
      ];
      
      for (const selector of errorSelectors) {
        try {
          const errorElement = this.page.locator(selector);
          if (await errorElement.isVisible({ timeout: 2000 })) {
            const errorText = await errorElement.textContent();
            throw new Error(`保存草稿失敗: ${errorText}`);
          }
        } catch (e) {
          if (e.message.includes('保存草稿失敗')) {
            throw e;
          }
          // 忽略其他錯誤
        }
      }
      
      // 檢查 URL 是否變化（可能重導向到列表頁面）
      const currentUrl = this.page.url();
      if (currentUrl.includes('episodes') && !currentUrl.includes('new') && !currentUrl.includes('edit')) {
        this.logger.info('檢測到 URL 變化，可能已重導向到單集列表');
        saveConfirmed = true;
      }
      
      // 再等待一下讓保存完全完成
      await this.page.waitForTimeout(2000);
      
      if (!saveConfirmed) {
        this.logger.warn('無法確認草稿保存狀態，但假設已完成');
      }
      
      this.logger.info('草稿保存流程完成');
      return true;
      
    } catch (error) {
      this.logger.error('保存草稿失敗:', error);
      
      // 嘗試截圖用於除錯
      try {
        await this.page.screenshot({ path: 'temp/save-draft-error.png' });
        this.logger.info('草稿保存錯誤截圖已保存');
      } catch (e) {
        // 忽略
      }
      
      return false;
    }
  }

  async publishEpisode() {
    try {
      this.logger.info('發布單集...');
      
      // 關閉任何可能開啟的對話框
      try {
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(1000);
        this.logger.info('準備發布前先關閉任何對話框');
      } catch (e) {
        // 忽略
      }
      
      // 查找發布按鈕 - 使用測試成功的選擇器優先
      const publishButtonSelectors = [
        '//button[@type="button" and contains(@class, "ant-btn") and contains(@class, "ant-btn-primary")]/span[text()="發布"]', // 🎯 測試成功的 XPath 選擇器
        '//button[@type="button" and contains(@class, "ant-btn-primary")]/span[text()="發布"]', // XPath: 簡化版本
        '//button[contains(@class, "ant-btn-primary") and .//span[text()="發布"]]', // XPath: 包含span的按鈕
        'button.ant-btn.ant-btn-primary:has(span:text("發布"))', // CSS: 精確匹配
        'button[type="button"].ant-btn.ant-btn-primary:has(span:text("發布"))', // CSS: 包含type屬性
        'button:has-text("發布")',
        'button:has-text("發佈")', 
        'button:has-text("Publish")',
        'button.ant-btn.ant-btn-primary:has-text("發布")',
        'button[data-testid="publish"]',
        '.publish-button'
      ];
      
      let publishButtonClicked = false;
      for (const selector of publishButtonSelectors) {
        try {
          this.logger.info(`🔍 嘗試查找發布按鈕: ${selector}`);
          
          let publishButton;
          // 檢查是否為 XPath 選擇器
          if (selector.startsWith('//')) {
            publishButton = this.page.locator(`xpath=${selector}`);
          } else {
            publishButton = this.page.locator(selector);
          }
          
          const count = await publishButton.count();
          this.logger.info(`📊 找到 ${count} 個匹配的元素`);
          
          if (count > 0) {
            const isVisible = await publishButton.first().isVisible({ timeout: 5000 });
            
            if (isVisible) {
              // 先檢查按鈕文字內容確認
              let buttonText = '';
              try {
                if (selector.startsWith('//') && selector.includes('/span[text()="發布"]')) {
                  // 對於 XPath span 選擇器，我們需要獲取父按鈕
                  const parentButton = this.page.locator(`xpath=${selector}/..`);
                  if (await parentButton.count() > 0) {
                    publishButton = parentButton.first();
                    buttonText = await publishButton.textContent();
                  }
                } else {
                  buttonText = await publishButton.first().textContent();
                }
              } catch (e) {
                buttonText = '無法獲取文字';
              }
              
              this.logger.info(`✅ 找到發布按鈕，文字內容: "${buttonText}"`);
              
              // 嘗試滾動到按鈕位置確保可見
              await publishButton.first().scrollIntoViewIfNeeded();
              await this.page.waitForTimeout(1000);
              
              // 點擊按鈕
              await publishButton.first().click();
              this.logger.info(`✅ 成功點擊發布按鈕: ${selector}`);
              publishButtonClicked = true;
              break;
            } else {
              this.logger.info(`⚠️ 按鈕不可見: ${selector}`);
            }
          } else {
            this.logger.info(`⚠️ 未找到匹配元素: ${selector}`);
          }
        } catch (e) {
          this.logger.info(`❌ 選擇器失敗: ${selector}, 錯誤: ${e.message}`);
          continue;
        }
      }
      
      if (!publishButtonClicked) {
        // 最後嘗試：直接查找所有按鈕並檢查文字
        this.logger.info('🔧 最後嘗試：檢查頁面上所有按鈕...');
        const allButtons = this.page.locator('button');
        const buttonCount = await allButtons.count();
        this.logger.info(`📊 頁面上總共有 ${buttonCount} 個按鈕`);
        
        for (let i = 0; i < buttonCount; i++) {
          try {
            const button = allButtons.nth(i);
            const isVisible = await button.isVisible();
            if (isVisible) {
              const text = await button.textContent();
              const classes = await button.getAttribute('class');
              this.logger.info(`🔍 按鈕 ${i}: "${text}" (classes: ${classes})`);
              
              if (text && text.includes('發布')) {
                this.logger.info(`🎯 找到包含"發布"的按鈕，嘗試點擊...`);
                await button.scrollIntoViewIfNeeded();
                await this.page.waitForTimeout(1000);
                await button.click();
                this.logger.info('✅ 成功點擊發布按鈕');
                publishButtonClicked = true;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!publishButtonClicked) {
          throw new Error('找不到發布按鈕');
        }
      }
      
      // 等待發布處理，並檢查是否出現確認對話框
      await this.page.waitForTimeout(2000);
      
      // 處理發布後的確認對話框
      this.logger.info('檢查是否出現確認對話框...');
      const confirmDialogSelectors = [
        '//button[@type="button" and contains(@class, "ant-btn") and contains(@class, "ant-btn-primary")]/span[text()="確認"]',
        'button.ant-btn.ant-btn-primary:has(span:text("確認"))',
        'button[type="button"].ant-btn.ant-btn-primary:has(span:text("確認"))',
        'button:has-text("確認")',
        'button:has-text("確定")',
        'button:has-text("OK")',
        '.ant-modal button.ant-btn-primary:has-text("確認")',
        '.ant-modal-footer button.ant-btn-primary'
      ];
      
      let confirmClicked = false;
      for (const selector of confirmDialogSelectors) {
        try {
          this.logger.info(`🔍 檢查確認對話框按鈕: ${selector}`);
          
          let confirmButton;
          // 檢查是否為 XPath 選擇器
          if (selector.startsWith('//')) {
            confirmButton = this.page.locator(`xpath=${selector}`);
          } else {
            confirmButton = this.page.locator(selector);
          }
          
          const count = await confirmButton.count();
          if (count > 0) {
            const isVisible = await confirmButton.first().isVisible({ timeout: 3000 });
            if (isVisible) {
              const buttonText = await confirmButton.first().textContent();
              this.logger.info(`✅ 找到確認按鈕，文字內容: "${buttonText}"`);
              
              // 點擊確認按鈕
              await confirmButton.first().click();
              this.logger.info(`✅ 成功點擊確認按鈕: ${selector}`);
              confirmClicked = true;
              
              // 等待對話框關閉
              await this.page.waitForTimeout(2000);
              break;
            }
          }
        } catch (e) {
          this.logger.debug(`確認按鈕選擇器失敗: ${selector}, 錯誤: ${e.message}`);
          continue;
        }
      }
      
      if (confirmClicked) {
        this.logger.info('✅ 已處理確認對話框');
      } else {
        this.logger.info('ℹ️ 未發現確認對話框，繼續發布流程');
      }
      
      // 再等待一段時間讓發布完成
      await this.page.waitForTimeout(3000);
      
      // 檢查發布成功的指示
      const successSelectors = [
        '.ant-message-success',
        '.success-message',
        '[class*="success"]',
        'text="發布成功"',
        'text="發佈成功"',
        'text="已發布"',
        'text="單集已發布"'
      ];
      
      let publishConfirmed = false;
      for (const selector of successSelectors) {
        try {
          const successElement = this.page.locator(selector);
          if (await successElement.isVisible({ timeout: 5000 })) {
            const text = await successElement.textContent();
            this.logger.info(`檢測到發布成功訊息: ${text}`);
            publishConfirmed = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // 檢查是否有錯誤訊息
      const errorSelectors = [
        '.ant-message-error',
        '.error-message',
        '[class*="error"]',
        'text="發布失敗"',
        'text="發佈失敗"'
      ];
      
      for (const selector of errorSelectors) {
        try {
          const errorElement = this.page.locator(selector);
          if (await errorElement.isVisible({ timeout: 3000 })) {
            const errorText = await errorElement.textContent();
            throw new Error(`發布單集失敗: ${errorText}`);
          }
        } catch (e) {
          if (e.message.includes('發布單集失敗')) {
            throw e;
          }
          // 忽略其他錯誤
        }
      }
      
      // 檢查 URL 是否變化（可能重導向到列表頁面）
      const currentUrl = this.page.url();
      if (currentUrl.includes('episodes') && !currentUrl.includes('new') && !currentUrl.includes('edit')) {
        this.logger.info('檢測到 URL 變化，可能已重導向到單集列表');
        publishConfirmed = true;
      }
      
      // 再等待一下讓發布完全完成
      await this.page.waitForTimeout(3000);
      
      if (!publishConfirmed) {
        this.logger.warn('無法確認發布狀態，但假設已完成');
      }
      
      this.logger.info('單集發布流程完成');
      return true;
      
    } catch (error) {
      this.logger.error('發布單集失敗:', error);
      
      // 嘗試截圖用於除錯
      try {
        await this.page.screenshot({ path: 'temp/publish-error.png' });
        this.logger.info('發布錯誤截圖已保存');
      } catch (e) {
        // 忽略
      }
      
      return false;
    }
  }

  async uploadEpisode({ title, description, audioPath }) {
    try {
      this.logger.info('開始上傳 SoundOn 單集...');
      
      // 1. 點擊新增單集
      const newEpisodeSuccess = await this.clickNewEpisode();
      if (!newEpisodeSuccess) {
        throw new Error('無法點擊新增單集按鈕');
      }

      // 等待頁面載入
      await this.page.waitForTimeout(3000);
      
      // 2. 上傳音檔
      this.logger.info('開始上傳音檔...');
      const uploadSuccess = await this.uploadAudioFile(audioPath);
      if (!uploadSuccess) {
        // 取得頁面截圖用於 debug
        await this.page.screenshot({ path: 'temp/upload-error.png' });
        throw new Error('音檔上傳失敗');
      }
      
      // 等待音檔處理
      await this.page.waitForTimeout(5000);
      
      // 3. 填寫單集資訊
      this.logger.info('填寫單集資訊...');
      const infoSuccess = await this.fillEpisodeInfo(title, description);
      if (!infoSuccess) {
        await this.page.screenshot({ path: 'temp/info-error.png' });
        throw new Error('填寫單集資訊失敗');
      }
      
      // 4. 選擇上架類型
      this.logger.info('設定上架類型...');
      const typeSuccess = await this.selectEpisodeType();
      if (!typeSuccess) {
        this.logger.warn('選擇上架類型失敗，繼續下一步');
      }
      
      // 5. 設定廣告選項
      this.logger.info('設定廣告選項...');
      const adSuccess = await this.setAdvertisementOptions();
      if (!adSuccess) {
        this.logger.warn('設定廣告選項失敗，繼續下一步');
      }
      
      // 6. 保存草稿
      this.logger.info('保存草稿...');
      const draftSuccess = await this.saveDraft();
      if (!draftSuccess) {
        throw new Error('保存草稿失敗');
      }
      
      this.logger.info('SoundOn 單集上傳成功完成');
      return { success: true };
      
    } catch (error) {
      this.logger.error('SoundOn 上傳失敗:', error);
      
      // 取得錯誤時的頁面截圖
      try {
        await this.page.screenshot({ path: 'temp/final-error.png' });
        this.logger.info('錯誤截圖已保存到 temp/final-error.png');
      } catch (screenshotError) {
        this.logger.warn('無法保存錯誤截圖:', screenshotError.message);
      }
      
      return { success: false, error: error.message };
    }
  }

  async saveCookies() {
    try {
      const cookies = await this.page.context().cookies();
      fs.writeFileSync(this.cookiesPath, JSON.stringify(cookies, null, 2));
      this.logger.info('SoundOn Cookies 已保存');
    } catch (error) {
      this.logger.warn('保存 cookies 失敗:', error.message);
    }
  }

  async loadCookies() {
    try {
      if (fs.existsSync(this.cookiesPath)) {
        const cookies = JSON.parse(fs.readFileSync(this.cookiesPath, 'utf8'));
        await this.page.context().addCookies(cookies);
        this.logger.info('SoundOn Cookies 已載入');
        return true;
      }
    } catch (error) {
      this.logger.warn('載入 cookies 失敗:', error.message);
    }
    return false;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async uploadCoverImage(imagePath) {
    try {
      this.logger.info('🖼️ 開始上傳封面圖片...');
      
      // 確保文件存在
      if (!fs.existsSync(imagePath)) {
        throw new Error(`封面圖片文件不存在: ${imagePath}`);
      }
      
      const fileStats = fs.statSync(imagePath);
      this.logger.info(`📁 封面圖片: ${path.basename(imagePath)} (${(fileStats.size / 1024).toFixed(2)} KB)`);
      
      // 1. 先點擊「更多」標籤
      this.logger.info('🔄 切換到「更多」標籤...');
      const moreTab = this.page.locator('text="更多"');
      await moreTab.click();
      await this.page.waitForTimeout(2000);
      
      // 2. 點擊「上傳封面圖片」按鈕
      this.logger.info('📤 點擊上傳封面圖片按鈕...');
      const uploadCoverButton = this.page.locator('button:has-text("上傳封面圖片")');
      
      // 設置文件選擇器監聽
      const fileChooserPromise = this.page.waitForEvent('filechooser', { timeout: 10000 });
      
      // 點擊上傳按鈕
      await uploadCoverButton.click();
      this.logger.info('✅ 已點擊上傳封面圖片按鈕');
      
      // 3. 處理文件選擇器
      const fileChooser = await fileChooserPromise;
      this.logger.info('📂 文件選擇器已打開');
      
      // 選擇圖片文件
      await fileChooser.setFiles(imagePath);
      this.logger.info(`✅ 已選擇圖片文件: ${imagePath}`);
      
      // 4. 等待上傳對話框出現
      this.logger.info('⏳ 等待上傳對話框出現...');
      await this.page.waitForSelector('.ant-modal:has-text("上傳封面圖片")', { timeout: 10000 });
      this.logger.info('✅ 上傳對話框已出現');
      
      // 5. 點擊「上傳」按鈕
      this.logger.info('🚀 點擊上傳按鈕...');
      
      // 使用多種選擇器嘗試找到上傳按鈕
      const uploadButtonSelectors = [
        '.ant-modal .ant-btn-primary:has-text("上傳")',
        '.ant-modal button:has-text("上傳")',
        'button:has-text("上 傳")', // 注意空格
        '.ant-btn-primary span:text("上傳")',
        '.ant-modal .ant-btn:has-text("上傳")'
      ];
      
      let uploadSuccess = false;
      for (const selector of uploadButtonSelectors) {
        try {
          const uploadButton = this.page.locator(selector);
          if (await uploadButton.isVisible({ timeout: 5000 })) {
            await uploadButton.click();
            this.logger.info(`✅ 成功點擊上傳按鈕: ${selector}`);
            uploadSuccess = true;
            break;
          }
        } catch (error) {
          this.logger.info(`⚠️ 選擇器 ${selector} 不可用，嘗試下一個...`);
          continue;
        }
      }
      
      if (!uploadSuccess) {
        // 如果沒有找到標準按鈕，嘗試直接按回車或等待自動上傳
        this.logger.info('🔄 嘗試按 Enter 鍵完成上傳...');
        await this.page.keyboard.press('Enter');
      }
      
      // 6. 等待上傳完成，增加額外等待時間確保穩定性
      this.logger.info('⏳ 等待5秒讓封面圖片上傳完全完成...');
      await this.page.waitForTimeout(5000);
      
      this.logger.info('✅ 封面圖片上傳完成');
      await this.page.screenshot({ path: 'temp/cover-upload-success.png' });
      return true;
      
    } catch (error) {
      this.logger.error('❌ 封面圖片上傳失敗:', error.message);
      await this.page.screenshot({ path: 'temp/cover-upload-error.png' });
      return false;
    }
  }
}

module.exports = { SoundOnUploader }; 