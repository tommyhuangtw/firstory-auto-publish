const Airtable = require('airtable');

class AirtableService {
  constructor() {
    this.base = new Airtable({
      apiKey: process.env.AIRTABLE_API_KEY
    }).base(process.env.AIRTABLE_BASE_ID);
    this.tableName = 'Daily Podcast Summary'; // 直接指定表格名稱
  }

  async getRecordsToUpload() {
    try {
      const records = await this.base(this.tableName).select({
        sort: [{ field: 'Date', direction: 'desc' }],
        maxRecords: 5
      }).firstPage();

      return records.map(record => ({
        id: record.id,
        title: record.get('Youtube Title1') || record.get('Title') || record.get('Podcast Title'),
        content: record.get('Raw Podcast Summary') || record.get('Content') || record.get('Summary'),
        description: record.get('Raw Podcast Summary') || record.get('Content') || record.get('Summary'),
        emailHtml: record.get('Email html'),
        audioFileId: record.get('Audio File ID'),
        coverImageId: record.get('Cover Image ID'),
        episodeNumber: record.get('Episode Number'),
        tags: record.get('Tags'),
        scheduledDate: record.get('Scheduled Date'),
        podcastLink: record.get('Podcast Link'),
        youtubeLink: record.get('Youtube Link1'),
        status: record.get('Upload Status') || record.get('Status') || 'Pending',
        date: record.get('Date')
      }));
    } catch (error) {
      console.error('從 Airtable 獲取資料失敗:', error);
      throw error;
    }
  }

  async getNextEpisodeToUpload() {
    try {
      const records = await this.base(this.tableName).select({
        sort: [{ field: 'Date', direction: 'desc' }],
        maxRecords: 1
      }).firstPage();

      if (records.length === 0) {
        return null;
      }

      const record = records[0];
      return {
        id: record.id,
        title: record.get('Youtube Title1') || record.get('Title'),
        content: record.get('Raw Podcast Summary') || record.get('Content'),
        emailHtml: record.get('Email html'),
        audioFileId: record.get('Audio File ID'),
        coverImageId: record.get('Cover Image ID'),
        episodeNumber: record.get('Episode Number'),
        tags: record.get('Tags'),
        scheduledDate: record.get('Scheduled Date'),
        podcastLink: record.get('Podcast Link'),
        youtubeLink: record.get('Youtube Link1')
      };
    } catch (error) {
      console.error('從 Airtable 獲取資料失敗:', error);
      throw error;
    }
  }

  async updateRecordStatus(recordId, status) {
    try {
      const updateData = {
        'Status': status,
        'Last Updated': new Date().toISOString()
      };

      if (status.includes('Uploaded')) {
        updateData['Upload Date'] = new Date().toISOString();
        updateData['Upload Status'] = 'Success';
      }

      await this.base(this.tableName).update(recordId, updateData);
      console.log(`Record ${recordId} 狀態已更新為: ${status}`);
    } catch (error) {
      console.error('更新 Airtable 狀態失敗:', error);
      throw error;
    }
  }

  async markEpisodeAsUploaded(recordId) {
    try {
      await this.base(this.tableName).update(recordId, {
        'Status': 'Uploaded',
        'Upload Date': new Date().toISOString(),
        'Upload Status': 'Success'
      });
      console.log(`Episode ${recordId} 標記為已上傳`);
    } catch (error) {
      console.error('更新 Airtable 狀態失敗:', error);
      throw error;
    }
  }

  async updateEpisodeStatus(recordId, status, error = null) {
    try {
      const updateData = {
        'Status': status,
        'Last Updated': new Date().toISOString()
      };

      if (error) {
        updateData['Error Message'] = error;
      }

      await this.base(this.tableName).update(recordId, updateData);
    } catch (err) {
      console.error('更新狀態失敗:', err);
    }
  }

  async getLatestEpisodeContent() {
    try {
      console.log('📊 從 Airtable 獲取最新單集內容...');
      console.log(`🔍 連接到表格: ${this.tableName}`);
      
      const records = await this.base(this.tableName).select({
        sort: [{ field: 'Date', direction: 'desc' }],
        maxRecords: 1,
        filterByFormula: `NOT({Email html} = '')` // 修正欄位名稱
      }).firstPage();

      if (records.length === 0) {
        throw new Error('沒有找到包含 Email html 的記錄');
      }

      const record = records[0];
      const emailHtml = record.get('Email html'); // 修正欄位名稱
      
      if (!emailHtml) {
        throw new Error('Email html 欄位為空');
      }

      console.log('✅ 找到最新記錄，開始生成標題和描述...');
      console.log(`📄 Email html 長度: ${emailHtml.length} 字元`);
      
      // 使用 AI 生成標題和描述
      const generatedContent = await this.generateTitleAndDescription(emailHtml);
      
      return {
        recordId: record.id,
        title: generatedContent.title,
        description: generatedContent.description,
        originalEmailHtml: emailHtml,
        date: record.get('Date'),
        rawContent: record.get('Raw Podcast Summary Raw') || '', // 可能的備用欄位
        status: record.get('Status') || 'Pending'
      };
      
    } catch (error) {
      console.error('❌ 從 Airtable 獲取內容失敗:', error.message);
      throw error;
    }
  }

  async generateTitleAndDescription(emailHtml) {
    try {
      console.log('🤖 使用 Gemini AI 生成標題和描述...');
      
      // 提取純文字內容（移除HTML標籤）
      const textContent = this.extractTextFromHtml(emailHtml);
      console.log(`📝 提取的文字內容長度: ${textContent.length} 字元`);
      
      // 第一步：生成10個候選標題
      console.log('🎯 第一步：生成10個候選標題...');
      const titleCandidates = await this.generateTitleCandidates(textContent);
      
      // 第二步：選擇最佳標題
      console.log('🏆 第二步：選擇最佳標題...');
      const bestTitle = await this.selectBestTitle(titleCandidates, textContent);
      
      // 第三步：生成5個工具的描述
      console.log('📝 第三步：生成5個工具的描述...');
      const description = await this.generateToolsDescription(textContent);
      
      return {
        title: bestTitle,
        description: description
      };
      
    } catch (error) {
      console.error('❌ AI 生成內容失敗:', error.message);
      
      // 備用方案：使用改進的智能模板
      return this.generateEnhancedFallback(emailHtml);
    }
  }

  async generateTitleCandidates(content) {
    try {
      const prompt = this.buildTitleGenerationPrompt(content);
      const response = await this.callGemini(prompt);
      
      // 解析10個標題
      if (response.titles && Array.isArray(response.titles)) {
        console.log(`✅ 成功生成 ${response.titles.length} 個候選標題`);
        return response.titles;
      }
      
      // 如果回應格式不對，嘗試解析文字內容
      return this.parseTitlesFromText(response.text || JSON.stringify(response));
      
    } catch (error) {
      console.error('❌ 生成標題候選失敗:', error.message);
      return this.getFallbackTitles();
    }
  }

  async selectBestTitle(titleCandidates, content) {
    try {
      const prompt = this.buildTitleSelectionPrompt(titleCandidates, content);
      const response = await this.callGemini(prompt);
      
      if (response.bestTitle) {
        console.log(`🏆 選出最佳標題: ${response.bestTitle}`);
        return response.bestTitle;
      }
      
      // 如果選擇失敗，使用第一個候選標題
      return titleCandidates[0] || this.getFallbackTitles()[0];
      
    } catch (error) {
      console.error('❌ 選擇最佳標題失敗:', error.message);
      return titleCandidates[0] || this.getFallbackTitles()[0];
    }
  }

  async generateToolsDescription(content) {
    try {
      const prompt = this.buildDescriptionPrompt(content);
      const response = await this.callGemini(prompt);
      
      if (response.description) {
        console.log('✅ 成功生成5個工具的描述');
        return response.description;
      }
      
      // 解析文字回應
      return this.parseDescriptionFromText(response.text || JSON.stringify(response));
      
    } catch (error) {
      console.error('❌ 生成描述失敗:', error.message);
      return this.getFallbackDescription();
    }
  }

  buildTitleGenerationPrompt(content) {
    return `
請根據以下 Podcast 內容，生成10個吸引人的標題。標題必須包含知名AI工具或公司名稱，讓用戶有熟悉感並想要點擊。

內容摘要：
${content}

標題要求：
1. 包含知名AI工具名稱（如：ChatGPT、Claude、Gemini、GPT-4、Midjourney、Stable Diffusion、OpenAI、Google、Microsoft、Meta等）
2. 要有吸引力和急迫感
3. 使用誇張但真實的形容詞（如：核彈級、爆發、狂飆、翻倍等）
4. 長度在15-30字之間
5. 適合台灣年輕族群

標題範例格式：
- AI 工具界核彈級更新！ChatGPT、Claude、Gemini 三強爭霸戰開打
- OpenAI 放大招！GPT-5 功能曝光，Claude 緊急應戰
- Google Gemini 2.0 狂飆升級！免費超越 GPT-4，開發者搶瘋了

請生成10個不同風格的標題，以JSON格式回傳：
{
  "titles": [
    "標題1",
    "標題2",
    "標題3",
    "標題4",
    "標題5",
    "標題6",
    "標題7",
    "標題8",
    "標題9",
    "標題10"
  ]
}
`;
  }

  buildTitleSelectionPrompt(titleCandidates, content) {
    return `
請從以下10個標題中選出最適合用於 Podcast 的標題。評選標準如下：

候選標題：
${titleCandidates.map((title, index) => `${index + 1}. ${title}`).join('\n')}

內容摘要：
${content.substring(0, 1000)}

評選標準（按重要性排序）：
1. 點擊吸引力：標題是否讓人想要點擊收聽？
2. 內容相關度：標題是否準確反映內容？
3. 知名度指標：是否包含用戶熟悉的AI工具或公司名稱？
4. 情感驅動：是否能激發好奇心、FOMO或學習動機？
5. 搜尋友善：是否包含熱門關鍵字？

請選出最佳標題，並簡述選擇理由。以JSON格式回傳：
{
  "bestTitle": "選中的最佳標題",
  "reason": "選擇理由（包含評分解析）",
  "score": {
    "clickAttraction": 9,
    "contentRelevance": 8,
    "brandFamiliarity": 10,
    "emotionalDrive": 9,
    "searchFriendly": 8
  }
}
`;
  }

  buildDescriptionPrompt(content) {
    return `
請根據以下內容，按照指定格式生成 Podcast 描述。描述必須包含5個AI工具，每個工具都要有具體的應用場景和價值說明。

內容摘要：
${content}

必須嚴格按照以下格式：

開頭段落（吸引人的總結，包含"全都交給 AI"和"精選 5 支熱門 AI 工具"字樣）🚀

💡 工具1名稱：簡短描述功能亮點
👉 具體應用場景和價值說明

💡 工具2名稱：簡短描述功能亮點  
👉 具體應用場景和價值說明

💡 工具3名稱：簡短描述功能亮點
👉 具體應用場景和價值說明

💡 工具4名稱：簡短描述功能亮點
👉 具體應用場景和價值說明

💡 工具5名稱：簡短描述功能亮點
👉 具體應用場景和價值說明

格式要求：
1. 每個💡後面要有具體的AI工具名稱
2. 每個👉要有實際的應用場景或價值
3. 語調輕鬆有趣，適合年輕族群
4. 工具要涵蓋不同領域（開發、設計、內容創作、自動化、分析等）
5. 總長度約200-350字

參考範例：
從找創業點子到打造 App，全都交給 AI！今天幫你精選 5 支熱門 AI 工具影片，讓寫程式變得跟玩一樣簡單 🚀 

💡 YouWare：免寫程式做網站，AI 寫前端快到炸！ 
👉 全自動 No-Code 開發平台，拖拉元件就能生成網站，還送 VIP 福利！ 

💡 Claude + Reddit 金礦挖掘法：45 分鐘找到百萬創業點子 
👉 結合 AI 與市場數據，一鍵產出 Landing Page，幫你測試商業模式。

請以JSON格式回傳：
{
  "description": "完整的描述內容"
}
`;
  }

  async callGemini(prompt) {
    try {
      console.log('🤖 呼叫 Gemini API...');
      
      // 如果有 Gemini API Key，使用真實 API
      if (process.env.GEMINI_API_KEY) {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }],
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.8,
              maxOutputTokens: 2048,
            }
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const content = data.candidates[0].content.parts[0].text;
          
          // 改進的 JSON 解析邏輯
          try {
            // 首先嘗試直接解析
            const parsed = JSON.parse(content);
            console.log('✅ Gemini API 回應成功 (直接JSON)');
            return parsed;
          } catch (e) {
            // 如果直接解析失敗，嘗試提取程式碼塊中的JSON
            try {
              // 查找 ```json 或 ``` 程式碼塊
              const jsonBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
              if (jsonBlockMatch) {
                const jsonStr = jsonBlockMatch[1];
                const parsed = JSON.parse(jsonStr);
                console.log('✅ Gemini API 回應成功 (程式碼塊JSON)');
                return parsed;
              }
              
              // 嘗試查找單獨的 { } 塊
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                console.log('✅ Gemini API 回應成功 (提取JSON)');
                return parsed;
              }
              
              console.log('⚠️ Gemini 回應不包含有效 JSON，返回純文字');
              return { text: content };
              
            } catch (parseError) {
              console.log('⚠️ Gemini JSON 解析失敗，返回純文字');
              return { text: content };
            }
          }
        } else {
          const errorData = await response.json();
          console.log('⚠️ Gemini API 請求失敗:', errorData);
        }
      }
      
      // 備用方案
      return this.generateSmartFallback();
      
    } catch (error) {
      console.error('❌ Gemini API 呼叫失敗:', error.message);
      return this.generateSmartFallback();
    }
  }

  parseTitlesFromText(text) {
    // 嘗試從文字中提取標題
    console.log('🔧 從文字中解析標題...');
    
    // 首先檢查是否有JSON格式的標題陣列
    const jsonMatch = text.match(/\{[\s\S]*"titles"[\s\S]*\[[\s\S]*\][\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.titles && Array.isArray(parsed.titles)) {
          console.log(`✅ 從JSON中解析出 ${parsed.titles.length} 個標題`);
          return parsed.titles;
        }
      } catch (e) {
        console.log('⚠️ JSON 解析失敗，嘗試文字解析...');
      }
    }
    
    // 嘗試從引號中提取標題
    const quoteMatches = text.match(/"([^"]{15,60})"/g);
    if (quoteMatches) {
      const titles = quoteMatches
        .map(match => match.replace(/"/g, ''))
        .filter(title => {
          // 過濾掉不像標題的內容
          return title.length >= 15 && 
                 title.length <= 60 && 
                 !title.includes('titles') &&
                 !title.includes('description') &&
                 (title.includes('AI') || title.includes('工具') || title.includes('ChatGPT') || title.includes('Claude') || title.includes('Gemini'));
        });
      
      if (titles.length >= 3) {
        console.log(`✅ 從引號中解析出 ${titles.length} 個標題`);
        return titles.slice(0, 10);
      }
    }
    
    // 嘗試從行中提取標題
    const lines = text.split('\n').filter(line => line.trim());
    const titles = [];
    
    for (const line of lines) {
      let cleanLine = line
        .replace(/^\d+\.\s*/, '')      // 移除數字開頭
        .replace(/^[-*]\s*/, '')       // 移除破折號開頭
        .replace(/^["\s]*/, '')        // 移除開頭引號和空格
        .replace(/["\s]*$/, '')        // 移除結尾引號和空格
        .trim();
      
      // 檢查是否為有效標題
      if (cleanLine.length >= 15 && 
          cleanLine.length <= 60 && 
          (cleanLine.includes('AI') || cleanLine.includes('工具') || 
           cleanLine.includes('ChatGPT') || cleanLine.includes('Claude') || 
           cleanLine.includes('Gemini') || cleanLine.includes('更新') ||
           cleanLine.includes('爆發') || cleanLine.includes('升級'))) {
        titles.push(cleanLine);
      }
    }
    
    if (titles.length >= 3) {
      console.log(`✅ 從文字行中解析出 ${titles.length} 個標題`);
      return titles.slice(0, 10);
    }
    
    console.log('⚠️ 無法解析標題，使用備用方案');
    return this.getFallbackTitles();
  }

  parseDescriptionFromText(text) {
    console.log('🔧 從文字中解析描述...');
    
    // 首先檢查是否有JSON格式的描述
    const jsonMatch = text.match(/\{[\s\S]*"description"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.description) {
          console.log('✅ 從JSON中解析出描述');
          // 清理描述中的轉義字符
          const cleanDesc = parsed.description
            .replace(/\\n/g, '\n')
            .replace(/\\\"/g, '"')
            .replace(/\\\\/g, '\\');
          return cleanDesc;
        }
      } catch (e) {
        console.log('⚠️ JSON 解析失敗，嘗試文字解析...');
      }
    }
    
    // 如果有完整的描述格式（包含💡和👉），直接返回
    if (text.includes('💡') && text.includes('👉')) {
      console.log('✅ 找到完整格式的描述');
      // 嘗試提取主要內容部分
      const contentMatch = text.match(/🚀[\s\S]*?(?=\n\n|$)/);
      if (contentMatch) {
        return text;
      }
    }
    
    // 嘗試從文字中構建描述
    const lines = text.split('\n').filter(line => line.trim());
    let extractedContent = '';
    let toolCount = 0;
    
    for (const line of lines) {
      if (line.includes('💡') || line.includes('👉')) {
        extractedContent += line + '\n';
        if (line.includes('💡')) toolCount++;
      }
    }
    
    if (toolCount >= 3) {
      console.log(`✅ 提取出包含 ${toolCount} 個工具的描述`);
      return '從找創業點子到打造 App，全都交給 AI！今天幫你精選 5 支熱門 AI 工具影片，讓寫程式變得跟玩一樣簡單 🚀\n\n' + extractedContent;
    }
    
    console.log('⚠️ 無法解析描述，使用備用方案');
    return this.getFallbackDescription();
  }

  getFallbackTitles() {
    return [
      'AI 工具界核彈級更新！ChatGPT、Claude、Gemini 三強爭霸',
      'OpenAI 放大招！GPT-5 功能曝光，Claude 緊急應戰',
      'Google Gemini 2.0 狂飆升級！免費超越 GPT-4',
      'AI 副業爆發中！ChatGPT + Claude 月入 10 萬攻略',
      'Meta 推出免費 AI 神器！挑戰 OpenAI 霸主地位',
      'Microsoft Copilot 大升級！Office 變身 AI 工作站',
      'Midjourney V7 震撼登場！AI 繪圖再次顛覆想像',
      'Claude 3.5 程式能力爆表！開發者狂讚：太強了',
      'AI 開發神器大集合！5 個工具讓你秒變程式高手',
      'ChatGPT 最新功能曝光！語音對話超越真人水準'
    ];
  }

  getFallbackDescription() {
    return `從找創業點子到打造 App，全都交給 AI！今天幫你精選 5 支熱門 AI 工具影片，讓寫程式變得跟玩一樣簡單 🚀 

💡 ChatGPT Advanced：程式碼生成再進化，寫 App 像寫作文
👉 全新程式模式支援多語言開發，初學者也能 30 分鐘做出原型！

💡 Claude 3.5 Sonnet：AI 寫程式的天花板，Bug 偵測神準
👉 上傳截圖自動生成前端代碼，設計稿秒變真實網頁！

💡 Cursor IDE：AI 編程助手內建，寫程式效率翻 10 倍
👉 智能補全、自動重構、Bug 修復，連資深工程師都在用！

💡 Replit Agent：零基礎做 App 的最佳選擇
👉 描述需求就能生成完整專案，部署上線一鍵搞定！

💡 GitHub Copilot：微軟 AI 程式夥伴，開發者必備神器
👉 智能建議、程式碼解釋、測試生成，團隊協作更順暢！`;
  }

  generateEnhancedFallback(emailHtml) {
    console.log('🔄 使用增強版備用方案生成內容...');
    
    // 從內容中提取關鍵字
    const keywords = this.extractAdvancedKeywords(emailHtml);
    const title = this.generateContextualTitle(keywords);
    const description = this.generateContextualDescription(keywords);
    
    return { title, description };
  }

  extractAdvancedKeywords(text) {
    const aiTools = [
      'ChatGPT', 'Claude', 'Gemini', 'GPT-4', 'GPT-5', 'Midjourney', 
      'Stable Diffusion', 'DALL-E', 'Cursor', 'GitHub Copilot', 
      'Replit', 'OpenAI', 'Anthropic', 'Google', 'Microsoft', 'Meta'
    ];
    
    const techTerms = [
      '程式', '開發', 'App', '網站', '自動化', '效率', '工具',
      '創業', '副業', '賺錢', 'No-Code', 'AI', '人工智慧'
    ];
    
    const foundTools = [];
    const foundTerms = [];
    
    aiTools.forEach(tool => {
      if (text.toLowerCase().includes(tool.toLowerCase())) {
        foundTools.push(tool);
      }
    });
    
    techTerms.forEach(term => {
      if (text.includes(term)) {
        foundTerms.push(term);
      }
    });
    
    return { tools: foundTools, terms: foundTerms };
  }

  generateContextualTitle(keywords) {
    const tools = keywords.tools.slice(0, 3);
    const today = new Date().toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
    
    if (tools.length >= 2) {
      return `AI 工具界核彈級更新！${tools.join('、')} 新功能讓工作效率飆升 10 倍`;
    } else if (tools.length === 1) {
      return `${tools[0]} 重大更新！AI 開發神器再進化，程式設計革命來了`;
    } else {
      return `AI 工具界大爆發！${today} 最新科技趨勢，開發者必看攻略`;
    }
  }

  generateContextualDescription(keywords) {
    const baseIntro = `從找創業點子到打造 App，全都交給 AI！今天幫你精選 5 支熱門 AI 工具影片，讓寫程式變得跟玩一樣簡單 🚀 

`;

    const tools = keywords.tools.length > 0 ? keywords.tools : [
      'ChatGPT', 'Claude', 'Cursor', 'GitHub Copilot', 'Replit'
    ];

    const toolDescriptions = [
      {
        name: tools[0] || 'ChatGPT',
        feature: '程式碼生成再進化，寫 App 像寫作文',
        value: '全新程式模式支援多語言開發，初學者也能 30 分鐘做出原型！'
      },
      {
        name: tools[1] || 'Claude',
        feature: 'AI 寫程式的天花板，Bug 偵測神準',
        value: '上傳截圖自動生成前端代碼，設計稿秒變真實網頁！'
      },
      {
        name: tools[2] || 'Cursor',
        feature: 'AI 編程助手內建，寫程式效率翻 10 倍',
        value: '智能補全、自動重構、Bug 修復，連資深工程師都在用！'
      },
      {
        name: tools[3] || 'GitHub Copilot',
        feature: '微軟 AI 程式夥伴，開發者必備神器',
        value: '智能建議、程式碼解釋、測試生成，團隊協作更順暢！'
      },
      {
        name: tools[4] || 'Replit',
        feature: '零基礎做 App 的最佳選擇',
        value: '描述需求就能生成完整專案，部署上線一鍵搞定！'
      }
    ];

    const formattedTools = toolDescriptions.map(tool => 
      `💡 ${tool.name}：${tool.feature}\n👉 ${tool.value}`
    ).join('\n\n');

    return baseIntro + formattedTools;
  }

  extractTextFromHtml(html) {
    // 簡單的 HTML 標籤移除
    return html
      .replace(/<[^>]*>/g, ' ')  // 移除所有HTML標籤
      .replace(/&nbsp;/g, ' ')   // 移除不間斷空格
      .replace(/&amp;/g, '&')    // 處理HTML實體
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')      // 多個空白字元合併為一個
      .trim()
      .substring(0, 4000);       // 限制長度
  }
}

module.exports = { AirtableService };