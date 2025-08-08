require('dotenv').config();

class OpenRouterService {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.baseURL = 'https://openrouter.ai/api/v1';
    this.models = {
      primary: 'google/gemini-2.5-flash',        // Google Gemini 2.5 Flash
      fallback: 'anthropic/claude-3.7-sonnet'    // Claude 3.7 Sonnet
    };
    
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY 環境變數未設定');
    }
  }

  async generateContent(prompt, options = {}) {
    const {
      temperature = 0.7,
      maxTokens = 2048,
      preferredModel = null,
      retryCount = 3
    } = options;

    // 決定要使用的模型順序
    const modelsToTry = preferredModel 
      ? [preferredModel, ...Object.values(this.models).filter(m => m !== preferredModel)]
      : [this.models.primary, this.models.fallback];

    let lastError = null;

    // 嘗試每個模型
    for (const model of modelsToTry) {
      console.log(`🤖 嘗試使用模型: ${model}`);
      
      // 重試邏輯
      for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
          const response = await this.callAPI(model, prompt, temperature, maxTokens);
          
          if (response.success) {
            console.log(`✅ 成功使用模型: ${model}`);
            return {
              success: true,
              model: model,
              content: response.content,
              usage: response.usage
            };
          }
        } catch (error) {
          lastError = error;
          console.log(`⚠️ 模型 ${model} 第 ${attempt} 次嘗試失敗: ${error.message}`);
          
          if (attempt < retryCount) {
            // 等待後重試（指數退避）
            const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
            console.log(`⏳ 等待 ${waitTime}ms 後重試...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
      }
    }

    // 所有嘗試都失敗
    console.error('❌ 所有模型都無法生成內容');
    return {
      success: false,
      error: lastError?.message || '所有模型呼叫失敗',
      model: null,
      content: null
    };
  }

  async callAPI(model, prompt, temperature, maxTokens) {
    try {
      const headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      };

      // 添加可選的 attribution headers
      if (process.env.OPENROUTER_SITE_URL) {
        headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL;
      }
      if (process.env.OPENROUTER_SITE_NAME) {
        headers['X-Title'] = process.env.OPENROUTER_SITE_NAME;
      }

      const requestBody = {
        model: model,
        messages: [{
          role: 'user',
          content: prompt
        }],
        temperature: temperature,
        max_tokens: maxTokens
      };

      console.log(`📤 發送請求到 OpenRouter (${model})...`);
      
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(`API 錯誤 (${response.status}): ${responseData.error?.message || JSON.stringify(responseData)}`);
      }

      if (!responseData.choices || responseData.choices.length === 0) {
        throw new Error('API 回應中沒有選擇');
      }

      const content = responseData.choices[0].message?.content;
      if (!content) {
        throw new Error('API 回應中沒有內容');
      }

      return {
        success: true,
        content: content,
        usage: responseData.usage || {}
      };

    } catch (error) {
      console.error(`❌ OpenRouter API 呼叫失敗 (${model}):`, error.message);
      throw error;
    }
  }

  // 專門用於解析 JSON 回應的方法
  async generateJSON(prompt, options = {}) {
    const response = await this.generateContent(prompt, options);
    
    if (!response.success) {
      return response;
    }

    try {
      // 嘗試從回應中提取 JSON
      const content = response.content;
      
      // 首先嘗試直接解析
      try {
        const parsed = JSON.parse(content);
        return {
          ...response,
          data: parsed
        };
      } catch (e) {
        // 嘗試從 markdown 代碼塊中提取
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);
          return {
            ...response,
            data: parsed
          };
        }
        
        // 嘗試找到第一個 JSON 對象
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          const parsed = JSON.parse(objectMatch[0]);
          return {
            ...response,
            data: parsed
          };
        }
        
        throw new Error('無法從回應中提取 JSON');
      }
    } catch (error) {
      console.error('❌ JSON 解析失敗:', error.message);
      return {
        ...response,
        success: false,
        error: `JSON 解析失敗: ${error.message}`,
        rawContent: response.content
      };
    }
  }

  // 測試連接
  async testConnection() {
    console.log('🔍 測試 OpenRouter 連接...');
    
    const testPrompt = '請回答：1+1等於多少？只需要回答數字。';
    const result = await this.generateContent(testPrompt, {
      maxTokens: 10,
      temperature: 0
    });
    
    if (result.success) {
      console.log('✅ OpenRouter 連接測試成功');
      console.log(`📊 使用的模型: ${result.model}`);
      console.log(`💬 回應: ${result.content}`);
    } else {
      console.error('❌ OpenRouter 連接測試失敗:', result.error);
    }
    
    return result;
  }
}

module.exports = { OpenRouterService };