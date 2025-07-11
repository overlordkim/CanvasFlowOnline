from flask import Flask, request, jsonify, Response, render_template
from flask_cors import CORS
from openai import OpenAI
import json
import logging
import os
import time
import hmac
from hashlib import sha1
import base64
import uuid
import requests
import threading
from threading import Thread
import sys

app = Flask(__name__)
CORS(app)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 存储聊天历史的内存数据库（生产环境应使用真实数据库）
chat_sessions = {}

# 存储图片生成任务的状态
image_generation_tasks = {}

# Liblib API配置
LIBLIB_ACCESS_KEY = os.getenv("LIBLIB_ACCESS_KEY")
LIBLIB_SECRET_KEY = os.getenv("LIBLIB_SECRET_KEY")
LIBLIB_API_URL_SUBMIT = "https://openapi.liblibai.cloud/api/generate/webui/text2img"
LIBLIB_API_URL_QUERY = "https://openapi.liblibai.cloud/api/generate/webui/status"

def generate_liblib_signature(uri, secret_key):
    """Generate signature required for Liblib API calls"""
    timestamp = str(int(time.time() * 1000))
    nonce = str(uuid.uuid4())
    content = f"{uri}&{timestamp}&{nonce}"
    digest = hmac.new(secret_key.encode(), content.encode(), sha1).digest()
    sign = base64.urlsafe_b64encode(digest).rstrip(b'=').decode()
    return {"signature": sign, "timestamp": timestamp, "signature_nonce": nonce}

def submit_liblib_image_task(prompt, options=None):
    """Submit image generation task to Liblib"""
    # Debug log
    logger.info(f"Submitting LibLib task, prompt: {prompt}")
    
    # Default parameters
    default_params = {
        "templateUuid": "6f7c4652458d4802969f8d089cf5b91f",
        "generateParams": {
            "checkPointId": "eaf48e4c8215499c99cbf46debf65a97",
            "vaeId": "",
            "prompt": prompt,
            "clipSkip": 2,
            "steps": 20,
            "width": 1024,
            "height": 1536,
            "imgCount": 1,
            "seed": -1,
            "restoreFaces": 0
        }
    }
    
    # If there are custom parameters, merge them into default parameters
    if options:
        default_params["generateParams"].update(options)
    
    # Generate API signature
    uri = "/api/generate/webui/text2img"
    sign = generate_liblib_signature(uri, LIBLIB_SECRET_KEY)
    
    # Build request URL
    params = f"?AccessKey={LIBLIB_ACCESS_KEY}&Signature={sign['signature']}&Timestamp={sign['timestamp']}&SignatureNonce={sign['signature_nonce']}"
    url = LIBLIB_API_URL_SUBMIT + params
    
    # Send request
    headers = {"Content-Type": "application/json"}
    try:
        resp = requests.post(url, headers=headers, data=json.dumps(default_params))
        if resp.status_code == 200:
            data = resp.json()
            if data.get("code") == 0:
                return data["data"]["generateUuid"]
            else:
                logger.error(f"Liblib submission failed, error code: {data.get('code')}, message: {data.get('msg')}")
        else:
            logger.error(f"Liblib HTTP error: {resp.status_code}")
    except Exception as e:
        logger.error(f"Liblib request exception: {e}")
    
    return None

def get_liblib_image_result(uuid_, max_wait_time=180, interval=5):
    """Get Liblib image generation results"""
    uri = "/api/generate/webui/status"
    start_time = time.time()
    
    while time.time() - start_time < max_wait_time:
        # Generate signature
        sign = generate_liblib_signature(uri, LIBLIB_SECRET_KEY)
        params = f"?AccessKey={LIBLIB_ACCESS_KEY}&Signature={sign['signature']}&Timestamp={sign['timestamp']}&SignatureNonce={sign['signature_nonce']}"
        url = LIBLIB_API_URL_QUERY + params
        
        # Send request
        headers = {"Content-Type": "application/json"}
        try:
            resp = requests.post(url, headers=headers, json={"generateUuid": uuid_})
            if resp.status_code == 200:
                result = resp.json()
                if result.get("code") == 0:
                    status = result["data"]["generateStatus"]
                    images = result["data"].get("images", [])
                    
                    if images and images[0].get("auditStatus") == 3:
                        return images[0]["imageUrl"]
                    elif images:
                        logger.warning("Image failed review")
                        return None
                    elif status in [4, 5]:
                        logger.error("Generation failed or blocked")
                        return None
                    else:
                        logger.info(f"Image generating...status: {status}")
            else:
                logger.error(f"Liblib HTTP error: {resp.status_code}")
        except Exception as e:
            logger.error(f"Liblib request exception: {e}")
            
        time.sleep(interval)
    
    logger.error("Image generation timeout")
    return None

def download_image(image_url, save_path):
    """Download image to local storage"""
    try:
        response = requests.get(image_url, stream=True)
        response.raise_for_status()
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        logger.info(f"Image download successful: {save_path}")
        return True
    except Exception as e:
        logger.error(f"Image download failed: {e}")
        return False

def generate_diverse_prompts(base_prompt):
    """
    Generate four different diversified prompts based on base prompt
    
    Args:
        base_prompt: Complete AI reply content including user requirement analysis and description
        
    Returns:
        List containing four different prompts
    """
    try:
        client = get_qwen_client()
        
        # Intelligently determine the type of input content
        meta_keywords_chinese = [
            '用户核心需求', '确定要求', '可变要求', '可接受选项', '英文基础描述',
            '完整绘画提示词', '基于', '想画', '风格', '构图', '氛围'
        ]
        meta_keywords_english = [
            'User core request', 'Key elements', 'must remain consistent', 'Optional variations',
            'English base description', 'complete drawing prompt', 'based on', 'want to draw',
            'style', 'composition', 'atmosphere', 'Subject:', 'Style:', 'Lighting:'
        ]
        is_meta_prompt = any(keyword in base_prompt for keyword in meta_keywords_chinese + meta_keywords_english)
        
        if is_meta_prompt:
            logger.info("Detected structured AI reply, using intelligent analysis mode")
            # If it's a structured AI reply, let AI intelligently analyze and generate diversity
            system_content = '''You are a professional AI image prompt generator. You will receive a complete reply from an AI assistant that includes analysis of the user's image creation needs.

## 🎯 **Core Understanding**

**Key Point: When users select multiple options, they want to try different feelings, not cram everything into one image!**

When users select multiple elements or styles:
- ❌ **Wrong Understanding**: Include all selected elements in each image
- ✅ **Correct Understanding**: Each image focuses on one element or style to create different unique feelings

## 📝 **Generation Strategy**

**Step 1: Identify Core Theme**
- Extract the basic subject the user wants to draw (e.g., cat, city, character, etc.)
- Identify basic style positioning (e.g., realistic, anime, sci-fi, etc.)

**Step 2: Create 4 Different Key Features**
Each image must have a key distinguishing feature from other images:

## 🎯 **Diversity Dimension Analysis**

**First analyze the user's diversity type selection:**

1. **If user selected different styles** → Create diversity in style dimension
   - Example: realistic, anime, oil painting, watercolor

2. **If user selected different elements/scenes** → Create diversity expansion in element dimension
   - Example: user selected "sleeping, playing" → can expand to "sleeping, playing, eating, bathing"
   - Example: user selected "underwater city, floating city" → can expand to "underwater city, floating city, space city, underground city"

3. **If user selected different emotions** → Create diversity in emotion dimension
   - Example: warm, mysterious, energetic, peaceful

4. **If user selected different compositions** → Create diversity in composition dimension
   - Example: close-up, panoramic, overhead, low-angle

## ⚠️ **Core Constraints**

**All prompts must include user's definite requirements:**
- If user confirmed "anime style", then all 4 prompts must explicitly include "anime style" or similar description
- If user confirmed "kitten", then all 4 prompts must include "cat"
- Definite requirements cannot be omitted in later prompts just because they were mentioned earlier!

**Diversity Principles:**
- Create 4 different variations within the same dimension
- Each variation should be clearly distinct but belong to the same category
- Maintain logical continuity and comparability

**Output Format (DO NOT use markdown bold formatting):**
PROMPT1: [All definite requirements] + [Diversity variant 1] + [Technical quality description]
---
PROMPT2: [All definite requirements] + [Diversity variant 2] + [Technical quality description]
---  
PROMPT3: [All definite requirements] + [Diversity variant 3] + [Technical quality description]
---
PROMPT4: [All definite requirements] + [Diversity variant 4] + [Technical quality description]

**IMPORTANT: Use plain text format. Do NOT use markdown bold (**) or italic (*) formatting.**

## 🌟 **Correct Application Examples**

**User selected "kitten sleeping" and "kitten playing" (element diversity):**
- PROMPT1: A cute cat sleeping peacefully, anime illustration style... 
- PROMPT2: A cute cat playing with yarn ball, anime illustration style...
- PROMPT3: A cute cat eating food happily, anime illustration style...
- PROMPT4: A cute cat grooming itself, anime illustration style...

**User selected "underwater city" and "floating city" (scene diversity):**
- PROMPT1: Underwater city with transparent domes, futuristic eco-tech style...
- PROMPT2: Floating city above clouds, futuristic eco-tech style...  
- PROMPT3: Space city among stars, futuristic eco-tech style...
- PROMPT4: Underground crystal city, futuristic eco-tech style...

**Key point: Each prompt includes all definite requirements, then creates diversity in the selected dimension!**

## ⚠️ **Important Constraints**

**🔴 Absolutely must follow these rules:**
1. **Definite requirements must be repeated**: If user confirmed "anime style", then each of the 4 prompts must include words like "anime style" or "anime illustration"
2. **Subject must be repeated**: If user confirmed drawing "kitten", then each of the 4 prompts must include the word "cat"
3. **Cannot omit later because mentioned earlier**: Each prompt must be an independent complete description
4. **Use English word separation**: Use spaces and commas for proper word separation, avoid Chinese punctuation

**Generation Principles:**
- Each image must have obvious visual differences
- Create 4 variants within the same logical dimension
- Ensure each prompt is complete and directly usable for AI image generation in English
- Use proper English grammar and punctuation'''
        else:
            logger.info("Detected simple English prompt, using generic diversity mode")
            # If it's a simple English prompt, use generic diversity generation
            system_content = '''You are a professional AI image prompt generator. You will receive a description and need to generate 4 English image prompts that **maintain core content consistency while diversifying details**.

## 🎯 **Core Principles**

1. **Core Content Consistency**: All prompts must include the same core subject and basic characteristics
2. **Detail Diversity**: Create diversity through different detail elements while maintaining core consistency

## 📝 **Diversity Dimensions**

**Composition Angle Diversity:**
- Close-up composition (close-up, portrait shot)
- Full body composition (full body, wide shot)  
- Environmental composition (environmental shot, scene composition)
- Dynamic composition (dynamic angle, action pose)

**Scene Detail Diversity:**
- Different background environments
- Different time settings
- Different atmospheres

**Color Scheme Diversity:**
- Warm tone variants
- Cool tone variants
- Contrasting color variants
- Natural color variants

**Lighting Effect Diversity:**
- Soft natural light
- Dramatic strong light
- Environmental ambient light
- Special lighting effects

**Output Format (DO NOT use markdown formatting):**
PROMPT1: [Core content] + [Variant 1 details]
---
PROMPT2: [Core content] + [Variant 2 details]
---
PROMPT3: [Core content] + [Variant 3 details]
---
PROMPT4: [Core content] + [Variant 4 details]

**IMPORTANT: Use plain text format. Do NOT use markdown bold (**) or italic (*) formatting.**'''
        
        # Build AI conversation messages
        messages = [
            {
                'role': 'system',
                'content': system_content
            },
            {
                'role': 'user',
                'content': f'Please intelligently analyze the following content and generate four diversified image prompts:\n\n{base_prompt}'
            }
        ]
        
        # Call AI to generate response
        response = client.chat.completions.create(
            model="qwen-plus",
            messages=messages,
            stream=False,
            temperature=0.7  # Moderate creativity
        )
        
        ai_response = response.choices[0].message.content
        prompt_type = "Structured AI reply analysis" if is_meta_prompt else "Simple prompt diversification"
        logger.info(f"AI generated {prompt_type} response: {ai_response}")
        
        # Parse AI response and extract four prompts
        prompts = []
        
        # Try multiple parsing strategies
        # Strategy 1: Split by --- and look for PROMPT patterns
        parts = ai_response.split('---')
        logger.info(f"Got {len(parts)} parts after splitting by ---")
        
        for i, part in enumerate(parts):
            part = part.strip()
            # Handle various formats: PROMPT1:, **PROMPT1:**, PROMPT 1:, etc.
            import re
            prompt_match = re.search(r'(?:\*\*)?PROMPT\s*\d+\s*:(?:\*\*)?\s*(.*)', part, re.DOTALL | re.IGNORECASE)
            if prompt_match:
                prompt = prompt_match.group(1).strip()
                # Remove any trailing markdown asterisks and clean up
                prompt = prompt.rstrip('*').strip()
                # Remove extra newlines and clean up text
                prompt = re.sub(r'\n+', ' ', prompt).strip()
                if prompt and len(prompt) > 30:  # Ensure prompt is not empty and has sufficient length
                    prompts.append(prompt)
                    logger.info(f"Successfully parsed prompt {i+1}: {prompt[:100]}...")
                else:
                    logger.warning(f"Prompt {i+1} is too short or empty: {prompt}")
            else:
                logger.info(f"Part {i+1} doesn't match PROMPT pattern: {part[:50]}...")
        
        # Strategy 2: If first strategy failed, try line-by-line parsing
        if len(prompts) < 4:
            logger.info("First parsing strategy insufficient, trying line-by-line parsing")
            lines = ai_response.split('\n')
            for line in lines:
                line = line.strip()
                prompt_match = re.search(r'(?:\*\*)?PROMPT\s*\d+\s*:(?:\*\*)?\s*(.*)', line, re.IGNORECASE)
                if prompt_match:
                    prompt = prompt_match.group(1).strip().rstrip('*').strip()
                    if prompt and len(prompt) > 30:
                        prompts.append(prompt)
                        logger.info(f"Line-parsed prompt: {prompt[:100]}...")
                        if len(prompts) >= 4:
                            break
        
        # If parsing fails, fall back to constrained variant generation
        if len(prompts) < 4:
            logger.warning(f"Insufficient AI-generated prompts, only parsed {len(prompts)}, using intelligent fallback")
            prompts = generate_intelligent_fallback_prompts(base_prompt, is_meta_prompt)
        
        logger.info(f"Final 4 diversified prompts generated:")
        for i, prompt in enumerate(prompts[:4]):
            logger.info(f"  {i+1}. {prompt}")
        return prompts[:4]  # Ensure returning 4
        
    except Exception as e:
        logger.error(f"Failed to generate diversified prompts: {e}")
        # Fallback: generate intelligent fallback variants
        return generate_intelligent_fallback_prompts(base_prompt, False)

def generate_intelligent_fallback_prompts(base_prompt, is_meta_prompt):
    """
    生成智能回退的prompt变体，确保保持确定要求的一致性
    """
    if is_meta_prompt:
        # 尝试从meta prompt中提取核心信息
        import re
        
        # 提取主体内容（如小猫、城市等）
        subject_patterns = [
            r'主体内容[：:\s]*([^。\n]*)',
            r'用户想画[：:\s]*([^。\n]*)',
            r'画[：:\s]*([^，。\n]*)'
        ]
        subject = ""
        for pattern in subject_patterns:
            match = re.search(pattern, base_prompt)
            if match:
                subject = match.group(1).strip()
                break
        
        # 提取艺术风格
        style_patterns = [
            r'艺术风格[：:\s]*([^，。\n]*)',
            r'风格[：:\s]*([^，。\n]*)',
            r'动漫[风格]*',
            r'anime[^，。\n]*'
        ]
        style = ""
        for pattern in style_patterns:
            match = re.search(pattern, base_prompt)
            if match:
                style = match.group(0) if '动漫' in pattern or 'anime' in pattern else match.group(1)
                style = style.strip()
                break
        
        # 尝试提取英文基础描述
        english_match = re.search(r'英文基础描述[：:\s]*```?\s*(.*?)(?:\s*```|$)', base_prompt, re.DOTALL)
        if english_match:
            core_prompt = english_match.group(1).strip()
        else:
            # 构建基础描述
            style_english = "anime illustration style" if "动漫" in style else style
            core_prompt = f"A {subject}, {style_english}".replace("A , ", "A ").strip(", ")
            if not core_prompt.startswith("A "):
                core_prompt = f"A beautiful artwork, {core_prompt}"
    else:
        core_prompt = base_prompt
    
    # 确保核心内容在每个变体中保持一致
    variations = [
        f"{core_prompt}, close-up composition, warm lighting, shallow depth of field, detailed textures",
        f"{core_prompt}, full scene composition, cool lighting, dynamic perspective, atmospheric effects", 
        f"{core_prompt}, artistic wide shot, dramatic lighting, rich colors, professional quality",
        f"{core_prompt}, creative angle, soft lighting, vibrant colors, ultra detailed rendering"
    ]
    return variations



def generate_single_image(task_id, image_index, prompt, callback_url=None):
    """Worker thread for generating a single image"""
    try:
        # Update task status
        if task_id in image_generation_tasks:
            image_generation_tasks[task_id]['images'][image_index]['status'] = 'generating'
        
        # Submit generation task
        uuid_ = submit_liblib_image_task(prompt)
        if not uuid_:
            if task_id in image_generation_tasks:
                image_generation_tasks[task_id]['images'][image_index]['status'] = 'failed'
                image_generation_tasks[task_id]['images'][image_index]['error'] = 'Task submission failed'
            return
        
        # Wait for result
        image_url = get_liblib_image_result(uuid_)
        if not image_url:
            if task_id in image_generation_tasks:
                image_generation_tasks[task_id]['images'][image_index]['status'] = 'failed'
                image_generation_tasks[task_id]['images'][image_index]['error'] = 'Generation failed'
            return
        
        # Download image to local storage
        filename = f"image_{task_id}_{image_index}_{int(time.time())}.jpg"
        save_path = os.path.join('static', 'generated_images', filename)
        
        if download_image(image_url, save_path):
            # Update task status
            if task_id in image_generation_tasks:
                image_generation_tasks[task_id]['images'][image_index]['status'] = 'completed'
                image_generation_tasks[task_id]['images'][image_index]['url'] = f"/static/generated_images/{filename}"
                image_generation_tasks[task_id]['images'][image_index]['original_url'] = image_url
        else:
            if task_id in image_generation_tasks:
                image_generation_tasks[task_id]['images'][image_index]['status'] = 'failed'
                image_generation_tasks[task_id]['images'][image_index]['error'] = 'Download failed'
        
    except Exception as e:
        logger.error(f"Error generating image: {e}")
        if task_id in image_generation_tasks:
            image_generation_tasks[task_id]['images'][image_index]['status'] = 'failed'
            image_generation_tasks[task_id]['images'][image_index]['error'] = str(e)

def get_qwen_client():
    """Get Qwen AI client"""
    return OpenAI(
        # Strongly recommend using environment variables or secure methods to manage your API Key
        api_key=os.getenv("QWEN_API_KEY"),
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

def ask_qwen_stream(messages, model="qwen-plus"):
    """
    Send messages to Qwen and return streaming response generator
    
    Args:
        messages: Message list
        model: Model to use, defaults to qwen-plus
        
    Yields:
        Streaming response data
    """
    client = get_qwen_client()
    
    try:
        # Call Qwen API with streaming response enabled
        stream = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True
        )
        
        # Process streaming response
        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content
                
    except Exception as e:
        logger.error(f"Qwen API call failed: {e}")
        yield f"Sorry, AI service is temporarily unavailable. Error message: {str(e)}"

@app.route('/')
def index():
    """Homepage route"""
    return render_template('index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    """Handle chat requests"""
    try:
        data = request.json
        message = data.get('message', '').strip()
        chat_id = data.get('chat_id', 'default')
        
        if not message:
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        # Get or create chat session
        if chat_id not in chat_sessions:
            chat_sessions[chat_id] = {
                'messages': [],
                'created': time.time()
            }
        
        session = chat_sessions[chat_id]
        
        # Add user message to session history
        session['messages'].append({
            'role': 'user',
            'content': message
        })
        
        # Prepare messages to send to AI (including conversation history)
        messages = [
            {
                'role': 'system',
                'content': '''⚠️ **Important Reminder: Only ask ONE question per reply! Absolutely no multiple questions at once!**

You are a professional AI drawing assistant. Your tasks are:
1. Understand what users want to create through natural, progressive conversation (ask only one question at a time)
2. Intelligently generate relevant follow-up questions based on user's specific choices (ask only one question at a time)
3. Be ready to start drawing based on available information at any time
4. Analyze definite requirements and variable requirements, generate intelligent meta prompts

## 🎨 **Conversation Strategy**

### **🚨 Core Principle: Only ask one question at a time**

**⚠️ Absolutely forbidden to ask multiple questions in one reply!**

- **One dimension at a time**: Each reply can only ask about one dimension choice, cannot ask about style + composition + color simultaneously
- **One DRAWING_OPTIONS at a time**: Each reply can contain at most one DRAWING_OPTIONS block
- **Progressive conversation**: Wait for user to choose this question, then ask the next question in the next round
- **Natural guidance**: First show interest in user's ideas, then naturally guide to a specific question
- **Avoid greediness**: Don't try to collect all information at once, be patient and go step by step

**❌ Wrong Example:**
```
What style do you want?
DRAWING_OPTIONS:Realistic|Anime|Oil Painting|Watercolor

What composition do you prefer?
DRAWING_OPTIONS:Close-up|Full Body|Environmental|Dynamic
```

**✅ Correct Example:**
```
What style do you want?
DRAWING_OPTIONS:Realistic|Anime|Oil Painting|Watercolor
```
Wait for user to choose, then ask about composition in the next round.

### **Dynamic Question Strategy**

**Core Idea: Generate relevant questions based on user's specific expressions**

**Example 1 - If user says "I want to draw a cute kitten":**
- Don't directly ask "What style do you prefer?"
- Should respond naturally then provide options:
```
Kittens are so cute! What kind of feeling do you want to create?

DRAWING_OPTIONS:Fluffy Realistic - High-definition photographic level real kitten, detailed fur texture, warm natural lighting|Adorable Cartoon - Cute anime style kitten, big eyes and round face, vibrant colors|Elegant Oil Painting - Classical painting style elegant kitten, thick brushstrokes, artistic atmosphere|Fresh Watercolor - Transparent watercolor effect kitten, soft colors, beautiful mood
```

**Example 2 - If user chose "Anime Illustration" style:**
- Continue deeper based on anime characteristics
```
Since you like anime illustration style, for the kitten's expression, which anime feeling do you prefer?

DRAWING_OPTIONS:Fresh Daily Life - Warm daily feeling like Miyazaki films, fresh natural colors|Dreamy Girl - Sweet and cute shoujo manga style, dreamy bubbles and flower elements|Healing Cute Pet - Adorable style like Totoro and Pikachu that makes people happy|Simple Lines - Clean and simple lines and color blocks, modern anime's minimalist beauty
```

**Example 3 - If user chose "Realistic Photography":**
- Focus on photography and kitten specific combination
```
Realistic photography of a kitten must be very charming! What kind of photography feeling do you prefer?

DRAWING_OPTIONS:Natural Lighting - Sunlight through windows shining on the kitten, warm home environment|Professional Studio - Perfect lighting setup, highlighting kitten's fur texture and eyes|Outdoor Portrait - Kitten's natural state in garden or grass|Artistic Portrait - Creative composition and lighting, showing kitten's elegant temperament
```

### **🚨 重要：DRAWING_OPTIONS格式要求**
- 必须使用DRAWING_OPTIONS:开头
- 选项之间用|分隔（这点非常重要！）
- 每个选项包含名称和描述，用-分隔
- 前面要有自然的引导性文字
- **每个回复最多只能有一个DRAWING_OPTIONS块！**
- **绝对不能在一个回复中问多个问题！**

### **何时提供选择选项**
除以下情况外，**每次回复都必须包含DRAWING_OPTIONS**：
- 用户明确说"开始绘画"、"开始画"等
- 用户已经提供了足够信息且主动建议开始绘画
- 用户表达不耐烦想直接开始

**典型需要提供选项的情况：**
- 用户刚说想画什么（如"我想画小猫"）
- 用户选择了一个选项，需要进一步细化
- 对话还在探索和确定需求阶段

### **智能判断何时深入**
- 根据用户当前的信息量判断是否需要继续询问
- 如果用户表达已经比较完整，主动建议开始绘画
- 避免无意义的重复询问

### **🚨 关键流程控制**

**流程分为两个阶段：**

**阶段1 - 确认选择（生成总结）：**
当用户发送"我确认选择：XXX。请根据我之前的所有选择，生成一个完整详细的绘画提示词描述，并提供开始绘画的选项。"时：
- 生成完整的meta prompt总结
- 在最后提供DRAWING_FINAL:开始绘画按钮
- **不要立即开始绘画！**

**阶段2 - 开始绘画（真正开始）：**
当用户发送以下类型的消息时，才真正开始绘画：
1. "开始绘画"、"开始画"、"开始作画"
2. 单独的开始指令（不包含"请生成描述"等）

**⚠️ 关键区别：**
- "确认选择+请生成描述" → 生成总结+提供按钮
- "开始绘画" → 直接开始，不再对话

## 📝 **Meta Prompt生成**

当决定开始绘画时，基于**整个对话历史**分析：

## 📝 **完整绘画提示词**

**用户核心需求：**
用户想画一张 [从对话中提取的核心内容] 的图片

**重要理解：用户选择多个选项的意图**
当用户选择了多个元素、风格或概念时，这表示用户想要"尝试不同的感觉"，而不是要在一张图里全部包含。后续的多样性生成将为每个选择创建不同的图片重点。

**确定要求（必须保持一致）：**
- 主体内容：[用户明确要画的内容]
- [只有当用户明确选择时才列出]艺术风格：[具体风格名称]
- [只有当用户明确选择时才列出]情绪氛围：[具体氛围要求]  
- [只有当用户明确选择时才列出]构图方式：[具体构图要求]
- [其他用户在对话中明确表达的要求]

**用户想要尝试的不同感觉：**
- [如果用户选择了多个选项，在这里列出，说明将为每个创建不同的图片重点]

**可变要求（用于多样性创作）：**
- [用户在对话中没有涉及的方面，如：光影效果、背景细节、色彩细节等]

**英文基础描述：**
[结合确定要求生成的英文prompt基础，为多样性生成提供基础]

DRAWING_FINAL:开始绘画

## ⚠️ **DRAWING_FINAL格式要求**
- DRAWING_FINAL:后面只能跟简短的按钮文字（如"开始绘画"）
- 不要在DRAWING_FINAL:后面放置长文本或其他内容
- 确保按钮文字不超过10个字符

## 🎯 **对话原则**

1. **🚨 一次一问**：每个回复只能问一个问题，只能有一个DRAWING_OPTIONS块
2. **自然流畅**：像朋友聊天一样自然，但必须在需要选择时输出正确的DRAWING_OPTIONS格式
3. **智能判断**：根据用户的回复判断下一步该问什么
4. **随时可画**：用户随时可以开始绘画，不强求选完所有维度
5. **记忆完整**：分析时要考虑整个对话的所有信息
6. **避免重复**：不要重复询问用户已经明确的内容
7. **耐心引导**：不要急于收集所有信息，一步一步来
6. **格式规范**：绝对不要在回复中使用代码块符号（```），避免触发前端代码区显示

**正确的对话流程示例：**

**第1轮对话：**
- 用户："我想画赛博朋克未来城市"
- AI："Cyberpunk style is so cool! Which color tone feeling do you prefer?
  DRAWING_OPTIONS:Neon Purple-Blue - Primarily purple and blue tones|Colorful Neon - Multiple colors intertwined|Cool Tech Blue - Cool-toned technological feel|Dark Red Metal - Deep red with metallic texture"

**第2轮对话：**
- 用户选择："霓虹紫蓝"
- AI："Purple-blue tones really capture the cyberpunk feeling! What time background do you prefer?
  DRAWING_OPTIONS:Midnight Neon - Bustling nightscape at midnight|Dusk Glow - City silhouette at sunset|Rainy Night Reflections - Neon reflections in rainwater|Dawn Mist - City looming in morning fog"

**第3轮对话：**
- 用户选择："深夜霓虹"，或者直接说"开始画吧" → 立即生成meta prompt并开始

**⚠️ 关键：每轮只问一个问题，等用户回复后再继续！绝对不能一次问多个问题！**

**完整示例 - 用户说"我想画一只可爱的小猫"时的正确回复：**
```
Kittens are so adorable! What kind of feeling do you want to create?

DRAWING_OPTIONS:Fluffy Realistic - High-definition photographic level real kitten, detailed fur texture, warm natural lighting|Adorable Cartoon - Cute anime style kitten, big eyes and round face, vibrant colors|Elegant Oil Painting - Classical painting style elegant kitten, thick brushstrokes, artistic atmosphere|Fresh Watercolor - Transparent watercolor effect kitten, soft colors, beautiful mood
```

## 🎯 **示例响应模式**

**阶段1示例 - 当用户说"我确认选择：动漫插画。请根据我之前的所有选择，生成一个完整详细的绘画提示词描述，并提供开始绘画的选项。"：**

Alright! Based on our conversation, I've organized your complete drawing requirements:

**User Core Requirements:**
User wants to draw a cute cat using anime illustration style

**Definite Requirements (must remain consistent):**
- Subject Content: A cute cat
- Art Style: Anime illustration style, big eyes, round face, vibrant colors

**Variable Requirements (for diverse creation):**
- Variations in expressions and actions
- Different background environments  
- Diverse color combinations

**English Base Description:**
A cute cat in anime illustration style, with big eyes and round face, colorful and vibrant

DRAWING_FINAL:Start Drawing

**阶段2示例 - 当用户单独说"开始绘画"时，直接开始，不再生成任何文本！**

**⚠️ 关键区别：确认选择阶段要生成总结+按钮，开始绘画阶段要直接开始！**

## 🚨 **最终提醒**
- **绝对禁止在一个回复中问多个问题**
- **每个回复最多只能有一个DRAWING_OPTIONS块**
- **一次一问，等用户回复后再继续**
- **不要急于收集所有信息，要有耐心！**'''
            }
        ]
        
        # 添加历史对话（保留最近10轮对话）
        recent_messages = session['messages'][-20:]  # 最近20条消息（10轮对话）
        messages.extend(recent_messages)
        
        def generate_response():
            """生成流式响应"""
            try:
                full_response = ""
                
                # 获取AI流式响应
                for content in ask_qwen_stream(messages):
                    full_response += content
                    # 返回SSE格式的数据
                    yield f"data: {json.dumps({'content': content})}\n\n"
                
                # 将AI响应添加到会话历史
                session['messages'].append({
                    'role': 'assistant', 
                    'content': full_response
                })
                
                # 发送结束信号
                yield f"data: [DONE]\n\n"
                
            except Exception as e:
                logger.error(f"Error generating response: {e}")
                error_msg = f"Sorry, an error occurred while processing your request: {str(e)}"
                yield f"data: {json.dumps({'content': error_msg})}\n\n"
                yield f"data: [DONE]\n\n"
        
        # 返回流式响应
        return Response(
            generate_response(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            }
        )
        
    except Exception as e:
        logger.error(f"Chat API error: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/generate_images', methods=['POST'])
def generate_images():
    """Handle image generation requests"""
    try:
        data = request.json
        base_prompt = data.get('prompt', '').strip()
        chat_id = data.get('chat_id', 'default')
        
        # 添加调试日志
        logger.info(f"Received image generation request - Chat ID: {chat_id}")
        logger.info(f"Received base prompt: {base_prompt}")
        
        if not base_prompt:
            return jsonify({'error': 'Prompt cannot be empty'}), 400
        
        # 创建任务ID
        task_id = str(uuid.uuid4())
        
        # 生成四个不同的prompts
        logger.info("Generating four diversified prompts...")
        diverse_prompts = generate_diverse_prompts(base_prompt)
        logger.info(f"Generated diverse prompts: {diverse_prompts}")
        
        # 初始化任务状态，每张图片保存对应的prompt
        image_generation_tasks[task_id] = {
            'status': 'pending',
            'base_prompt': base_prompt,
            'chat_id': chat_id,
            'created': time.time(),
            'images': [
                {'status': 'pending', 'url': None, 'error': None, 'prompt': diverse_prompts[i]} 
                for i in range(4)
            ]
        }
        
        # 创建一个后台线程来间隔提交四个图片生成任务
        def submit_tasks_with_delay():
            """Submit four image generation tasks with intervals to avoid API conflicts"""
            for i in range(4):
                # 使用对应的多样化prompt
                prompt = diverse_prompts[i]
                logger.info(f"Submitting generation task for image {i+1}, prompt: {prompt}")
                
                # 在后台线程中启动单个图片生成任务
                thread = Thread(target=generate_single_image, args=(task_id, i, prompt))
                thread.daemon = True
                thread.start()
                
                # 如果不是最后一个任务，等待一段时间再提交下一个
                if i < 3:
                    time.sleep(3)  # 间隔3秒提交下一个任务
        
        # 启动任务提交线程
        submit_thread = Thread(target=submit_tasks_with_delay)
        submit_thread.daemon = True
        submit_thread.start()
            
        return jsonify({
            'task_id': task_id,
            'status': 'started',
            'message': 'Image generation task started',
            'diverse_prompts': diverse_prompts  # 返回生成的多样化prompts供调试
        })
        
    except Exception as e:
        logger.error(f"Image generation API error: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/api/generate_images/<task_id>', methods=['GET'])
def get_generation_status(task_id):
    """Get image generation status"""
    try:
        if task_id not in image_generation_tasks:
            return jsonify({'error': 'Task not found'}), 404
        
        task = image_generation_tasks[task_id]
        
        # 计算整体状态
        all_completed = all(img['status'] == 'completed' for img in task['images'])
        any_failed = any(img['status'] == 'failed' for img in task['images'])
        any_generating = any(img['status'] == 'generating' for img in task['images'])
        
        if all_completed:
            overall_status = 'completed'
        elif any_failed and not any_generating:
            overall_status = 'failed'
        elif any_generating:
            overall_status = 'generating'
        else:
            overall_status = 'pending'
        
        return jsonify({
            'task_id': task_id,
            'status': overall_status,
            'base_prompt': task.get('base_prompt', task.get('prompt', '')),  # 兼容旧格式
            'chat_id': task['chat_id'],
            'created': task['created'],
            'images': task['images']  # 现在包含每张图片的prompt信息
        })
        
    except Exception as e:
        logger.error(f"Error getting generation status: {e}")
        return jsonify({'error': 'Internal server error'}), 500



@app.route('/api/chats', methods=['GET'])
def get_chats():
    """Get all chat sessions"""
    chats = []
    for chat_id, session in chat_sessions.items():
        chat_info = {
            'id': chat_id,
            'title': 'New Conversation',
            'created': session['created'],
            'message_count': len(session['messages'])
        }
        
        # 如果有消息，用第一条用户消息作为标题
        user_messages = [msg for msg in session['messages'] if msg['role'] == 'user']
        if user_messages:
            first_msg = user_messages[0]['content']
            chat_info['title'] = first_msg[:30] + ('...' if len(first_msg) > 30 else '')
        
        chats.append(chat_info)
    
    # 按创建时间排序
    chats.sort(key=lambda x: x['created'], reverse=True)
    return jsonify(chats)

@app.route('/api/chats/<chat_id>', methods=['GET'])
def get_chat(chat_id):
    """Get specific chat session"""
    if chat_id not in chat_sessions:
        return jsonify({'error': 'Chat session not found'}), 404
    
    session = chat_sessions[chat_id]
    return jsonify({
        'id': chat_id,
        'messages': session['messages'],
        'created': session['created']
    })

@app.route('/api/chats/<chat_id>', methods=['DELETE'])
def delete_chat(chat_id):
    """Delete chat session"""
    if chat_id not in chat_sessions:
        return jsonify({'error': 'Chat session not found'}), 404
    
    del chat_sessions[chat_id]
    return jsonify({'message': 'Chat session deleted'})

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': time.time(),
        'active_chats': len(chat_sessions)
    })

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Server error: {error}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # 确保模板文件夹存在
    template_dir = os.path.join(os.path.dirname(__file__), 'templates')
    if not os.path.exists(template_dir):
        os.makedirs(template_dir)
    
    # 将index.html移动到templates文件夹
    index_path = os.path.join(os.path.dirname(__file__), 'index.html')
    template_path = os.path.join(template_dir, 'index.html')
    
    if os.path.exists(index_path) and not os.path.exists(template_path):
        import shutil
        shutil.move(index_path, template_path)
    
    print("CanvasFlow server starting...")
    print("Visit http://localhost:5050 to start conversation")
    print("Press Ctrl+C to stop server")
    
    app.run(
        host='0.0.0.0',
        port=5050,
        debug=True,
        threaded=True
    ) 