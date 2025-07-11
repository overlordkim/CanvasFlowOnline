class CanvasFlow {
    constructor() {
        this.currentChatId = 'default';
        this.chats = {};
        this.isStreaming = false;
        this.streamingChatId = null; // 追踪正在流式回复的对话ID
        this.streamingMessageElement = null; // 追踪流式回复的消息元素
        this.userScrolledUp = false; // 追踪用户是否向上滚动了
        
        // 图片生成相关
        this.currentTaskId = null;
        this.generationStartTime = null;
        this.generationChatId = null;
        this.currentImageGrid = null;
        this.currentImageBubble = null;
        this.preparingGeneration = false; // 🆕 标记正在准备生成（已创建气泡但还没task_id）
        
        // 定时器管理 - 防止多个轮询同时运行
        this.pollingTimerId = null;
        this.backgroundPollingTimerId = null;
        
        // 🎯 保存完整的meta prompt用于重新生成
        this.lastMetaPrompt = null;
        
        this.initializeElements();
        this.bindEvents();
        this.updateCharCount();
        this.loadFromStorage();
        this.initializeDefaultChat();
        this.initializeMarkdown();
    }
    
    initializeElements() {
        this.messageInput = document.getElementById('message-input');
        this.sendBtn = document.getElementById('send-btn');
        this.messagesContainer = document.getElementById('messages');
        this.charCount = document.querySelector('.char-count');
        this.statusText = document.querySelector('.status-text');
        this.statusIndicator = document.querySelector('.status-indicator');
        this.newChatBtn = document.getElementById('new-chat');
        this.chatHistory = document.querySelector('.chat-history');
    }
    
    bindEvents() {
        // 输入框事件
        this.messageInput.addEventListener('input', () => {
            this.updateCharCount();
            this.autoResize();
            this.toggleSendButton();
        });
        
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // 发送按钮事件
        this.sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });
        
        // 新对话按钮事件
        this.newChatBtn.addEventListener('click', () => {
            this.createNewChat();
        });
        
        // 示例提示按钮事件
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('example-btn')) {
                this.messageInput.value = e.target.textContent;
                this.updateCharCount();
                this.toggleSendButton();
                this.messageInput.focus();
            }
        });
        
        // 监听滚动事件，检测用户是否手动滚动
        this.messagesContainer.addEventListener('scroll', () => {
            this.checkScrollPosition();
        });
    }
    
    initializeDefaultChat() {
        // 这个方法现在不需要了，因为我们在updateSidebar中动态创建所有对话项
        // 保留这个方法以防未来需要
    }
    
    initializeMarkdown() {
        // 配置marked库
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                highlight: function(code, lang) {
                    if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                        try {
                            return hljs.highlight(code, { language: lang }).value;
                        } catch (err) {
                            console.error('代码高亮失败:', err);
                        }
                    }
                    return code;
                },
                breaks: true,
                gfm: true,
                sanitize: false // We will handle security manually
            });
        }
    }
    
    renderMarkdown(content) {
        // If marked library is not available, return original content
        if (typeof marked === 'undefined') {
            return content;
        }
        
        try {
            // Preprocess content: clean up extra blank lines
            let cleanContent = content
                // Remove consecutive blank lines, keep at most one blank line
                .replace(/\n\s*\n\s*\n+/g, '\n\n')
                // Remove blank lines at beginning and end
                .replace(/^\s*\n+/, '')
                .replace(/\n+\s*$/, '')
                // Remove trailing spaces
                .replace(/[ \t]+$/gm, '');
            
            // Render markdown
            let html = marked.parse(cleanContent);
            
            // Simple XSS protection: remove script tags
            html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            html = html.replace(/javascript:/gi, '');
            html = html.replace(/on\w+\s*=/gi, '');
            
            // Further clean up whitespace in HTML
            html = html
                // Remove consecutive empty <p> tags
                .replace(/<p>\s*<\/p>/gi, '')
                // Remove <p> tags containing only whitespace characters
                .replace(/<p>[\s\u00A0]*<\/p>/gi, '')
                // Remove extra whitespace between <p> tags
                .replace(/<\/p>\s*<p>/gi, '</p><p>')
                // Remove whitespace around <br> tags and limit consecutive <br> count
                .replace(/\s*<br\s*\/?>\s*/gi, '<br>')
                .replace(/(<br>){3,}/gi, '<br><br>')
                // Clean up whitespace at beginning and end
                .trim();
            
            return html;
        } catch (error) {
                    console.error('Markdown rendering failed:', error);
        return content;
        }
    }
    
    highlightCodeBlocks(container) {
        // If hljs library is not available, return directly
        if (typeof hljs === 'undefined') {
            return;
        }
        
        try {
            // Find all code blocks and highlight them
            const codeBlocks = container.querySelectorAll('pre code');
            codeBlocks.forEach(block => {
                // Check if already highlighted
                if (!block.classList.contains('hljs')) {
                    hljs.highlightElement(block);
                }
            });
        } catch (error) {
            console.error('Code highlighting failed:', error);
        }
    }
    
    cleanupWhitespace(container) {
        try {
            // 移除纯空白的文本节点
            const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );
            
            const nodesToRemove = [];
            let node;
            
            while (node = walker.nextNode()) {
                // 如果是纯空白节点（只包含空格、换行、制表符等）
                if (node.nodeType === Node.TEXT_NODE && 
                    /^\s*$/.test(node.textContent) && 
                    node.textContent.length > 0) {
                    // 检查是否在pre或code标签内，这些地方需要保留空白
                    const isInPreservedElement = node.parentElement && 
                        (node.parentElement.tagName === 'PRE' || 
                         node.parentElement.tagName === 'CODE');
                    
                    if (!isInPreservedElement) {
                        nodesToRemove.push(node);
                    }
                }
            }
            
            // 移除空白节点
            nodesToRemove.forEach(node => {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            });
            
        } catch (error) {
            console.error('Whitespace cleanup failed:', error);
        }
    }
    
    checkScrollPosition() {
        const container = this.messagesContainer;
        const threshold = 50; // 50px的误差范围
        
        // 检查是否在底部附近
        const isNearBottom = container.scrollTop + container.clientHeight >= 
                            container.scrollHeight - threshold;
        
        this.userScrolledUp = !isNearBottom;
        
        // 如果用户滚动到底部，隐藏新消息提示
        if (!this.userScrolledUp) {
            this.hideNewMessageIndicator();
        }
    }
    
    smartScrollToBottom() {
        // 只有在用户没有向上滚动时才自动滚动到底部
        if (!this.userScrolledUp) {
            this.scrollToBottom();
        } else {
            // 如果用户向上滚动了，显示新消息提示
            this.showNewMessageIndicator();
        }
    }
    
    showNewMessageIndicator() {
        // 检查是否已经有指示器
        if (document.querySelector('.new-message-indicator')) {
            return;
        }
        
        const indicator = document.createElement('div');
        indicator.className = 'new-message-indicator';
        indicator.innerHTML = `
            <div class="new-message-content">
                <span>New reply</span>
                <button class="scroll-to-bottom-btn">View</button>
            </div>
        `;
        
        // 添加点击事件
        indicator.querySelector('.scroll-to-bottom-btn').addEventListener('click', () => {
            this.scrollToBottom();
            this.userScrolledUp = false;
            this.hideNewMessageIndicator();
        });
        
        this.messagesContainer.appendChild(indicator);
    }
    
    hideNewMessageIndicator() {
        const indicator = document.querySelector('.new-message-indicator');
        if (indicator) {
            indicator.remove();
        }
    }
    
    saveToStorage() {
        try {
            localStorage.setItem('canvasflow_chats', JSON.stringify(this.chats));
            localStorage.setItem('canvasflow_current_chat', this.currentChatId);
        } catch (error) {
            console.error('Failed to save to local storage:', error);
        }
    }
    
    loadFromStorage() {
        try {
            const savedChats = localStorage.getItem('canvasflow_chats');
            const savedCurrentChat = localStorage.getItem('canvasflow_current_chat');
            
            if (savedChats) {
                this.chats = JSON.parse(savedChats);
                // 为旧版本的对话数据添加lastMessageTime字段
                Object.values(this.chats).forEach(chat => {
                    if (!chat.hasOwnProperty('lastMessageTime')) {
                        chat.lastMessageTime = null;
                    }
                });
            }
            
            if (savedCurrentChat && this.chats[savedCurrentChat]) {
                this.currentChatId = savedCurrentChat;
            }
            
            // 如果没有任何对话，创建默认对话
            if (Object.keys(this.chats).length === 0) {
                this.chats['default'] = {
                    id: 'default',
                    title: 'New Chat',
                    messages: [],
                    created: Date.now(),
                    lastMessageTime: null
                };
                this.currentChatId = 'default';
            }
            
            // 更新侧边栏
            this.updateSidebar();
            
            // 加载当前对话
            this.loadChatMessages();
            
        } catch (error) {
            console.error('Failed to load from local storage:', error);
            // Create default chat
            this.chats['default'] = {
                id: 'default',
                title: 'New Chat',
                messages: [],
                created: Date.now(),
                lastMessageTime: null
            };
            this.currentChatId = 'default';
            this.updateSidebar();
            this.loadChatMessages();
        }
    }
    
    updateSidebar() {
        const chatHistory = document.querySelector('.chat-history');
        chatHistory.innerHTML = '';
        
        // 按最新回复时间排序，没有消息的按创建时间排序
        const sortedChats = Object.values(this.chats).sort((a, b) => {
            const aTime = a.lastMessageTime || a.created;
            const bTime = b.lastMessageTime || b.created;
            return bTime - aTime;
        });
        
        sortedChats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item';
            if (chat.id === this.currentChatId) {
                chatItem.classList.add('active');
            }
            chatItem.setAttribute('data-chat-id', chat.id);
            
            // 添加状态指示器
            const statusIndicator = document.createElement('div');
            statusIndicator.className = 'chat-status-indicator';
            if (this.isStreaming && this.streamingChatId === chat.id) {
                statusIndicator.classList.add('streaming');
            }
            
            const title = document.createElement('div');
            title.className = 'chat-title';
            title.textContent = chat.title;
            
            const preview = document.createElement('div');
            preview.className = 'chat-preview';
            
            if (chat.messages.length > 0) {
                const lastMessage = chat.messages[chat.messages.length - 1];
                const previewText = lastMessage.content.substring(0, 50) + (lastMessage.content.length > 50 ? '...' : '');
                preview.textContent = previewText;
            } else {
                preview.textContent = 'Start your conversation...';
            }
            
            // 组装聊天项目
            const chatContent = document.createElement('div');
            chatContent.className = 'chat-content';
            chatContent.appendChild(title);
            chatContent.appendChild(preview);
            
            // 添加删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'chat-delete-btn';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = 'Delete chat';
            
            chatItem.appendChild(statusIndicator);
            chatItem.appendChild(chatContent);
            chatItem.appendChild(deleteBtn);
            
            // 添加点击事件
            chatItem.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，不触发切换对话
                if (e.target === deleteBtn) {
                    return;
                }
                this.switchToChat(chat.id);
            });
            
            // 添加删除按钮事件
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent bubbling
                this.deleteChat(chat.id);
            });
            
            chatHistory.appendChild(chatItem);
        });
    }
    
    updateCharCount() {
        const count = this.messageInput.value.length;
        this.charCount.textContent = `${count}/4000`;
        
        if (count > 3800) {
            this.charCount.style.color = '#F85149';
        } else if (count > 3000) {
            this.charCount.style.color = '#D29922';
        } else {
            this.charCount.style.color = '#8B949E';
        }
    }
    
    autoResize() {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
    }
    
    toggleSendButton() {
        const hasText = this.messageInput.value.trim().length > 0;
        this.sendBtn.disabled = !hasText || this.isStreaming;
    }
    
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isStreaming) return;
        
        // 禁用之前所有的绘画选项
        this.disableAllPreviousDrawingOptions();
        
        // 清空输入框
        this.messageInput.value = '';
        this.updateCharCount();
        this.toggleSendButton();
        this.autoResize();
        
        // 调用内部发送方法，显示用户消息
        await this.sendMessageInternal(message, true);
    }
    
    async handleStreamResponse(response, targetChatId) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        this.hideTypingIndicator();
        this.setStatus('streaming', 'Replying...');
        
        // 设置流式回复状态
        this.streamingChatId = targetChatId;
        this.isStreaming = true;
        
        // 更新侧边栏以显示流式回复状态
        this.updateSidebar();
        
        // 只有当前显示的对话是目标对话时才隐藏欢迎消息和显示消息
        const isCurrentChat = this.currentChatId === targetChatId;
        
        let messageElement = null;
        if (isCurrentChat) {
            // 隐藏欢迎消息（如果存在）
            this.hideWelcomeMessage();
            
            // 创建助手消息容器并添加到DOM
            messageElement = this.createMessageElement('assistant', '');
            this.messagesContainer.appendChild(messageElement);
            this.scrollToBottom();
        }
        
        // 保存消息元素引用，用于跨对话切换时恢复
        this.streamingMessageElement = messageElement;
        
        let fullResponse = '';
        
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        
                        if (data === '[DONE]') {
                            this.isStreaming = false;
                            this.streamingChatId = null;
                            this.streamingMessageElement = null;
                            this.setStatus('ready', 'Ready');
                            this.toggleSendButton();
                            // 更新侧边栏以移除流式回复状态
                            this.updateSidebar();
                            break;
                        }
                        
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content) {
                                fullResponse += parsed.content;
                                
                                // 检查是否需要更新界面
                                const shouldUpdateUI = this.currentChatId === targetChatId;
                                if (shouldUpdateUI) {
                                    // 如果没有消息元素（可能切换回来了），创建一个
                                    if (!this.streamingMessageElement) {
                                        this.hideWelcomeMessage();
                                        this.hideTypingIndicator(); // 清理可能存在的打字指示器
                                        this.streamingMessageElement = this.createMessageElement('assistant', '');
                                        this.messagesContainer.appendChild(this.streamingMessageElement);
                                    }
                                    // 对流式响应也进行内容清理
                                    this.updateMessageContent(this.streamingMessageElement, fullResponse);
                                }
                            }
                        } catch (e) {
                            console.error('解析JSON失败:', e, 'data:', data);
                        }
                    }
                }
            }
            
            // 保存消息到指定的聊天历史
            if (fullResponse) {
                this.addToHistoryForChat(targetChatId, 'assistant', fullResponse);
                this.updateChatPreviewForChat(targetChatId);
                
                // 🆕 检查是否需要处理后台图片生成任务
                this.checkAndProcessBackgroundImageGeneration(targetChatId, fullResponse);
                
                // 流式回复完成后，如果是当前对话且用户向上滚动了，确保显示新消息提示
                if (this.currentChatId === targetChatId && this.userScrolledUp) {
                    this.showNewMessageIndicator();
                }
            } else {
                console.log('警告：没有收到任何回复内容');
            }
            
        } catch (error) {
            console.error('流式响应处理错误:', error);
            this.setStatus('error', 'Response error');
            // 显示错误消息
            if (this.currentChatId === targetChatId && this.streamingMessageElement) {
                this.updateMessageContent(this.streamingMessageElement, 'Sorry, an error occurred while getting the response. Please try again later.');
            }
        } finally {
            this.isStreaming = false;
            this.streamingChatId = null;
            this.streamingMessageElement = null;
            this.toggleSendButton();
            // 更新侧边栏以移除流式回复状态
            this.updateSidebar();
        }
    }
    
    addMessage(role, content) {
        this.addMessageToChat(this.currentChatId, role, content);
    }
    
    addMessageToChat(chatId, role, content) {
        // 只有当前显示的对话才需要更新界面
        if (chatId === this.currentChatId) {
            // 隐藏欢迎消息（如果存在）
            this.hideWelcomeMessage();
            
        const messageElement = this.createMessageElement(role, content);
        this.messagesContainer.appendChild(messageElement);
        
            // 对于用户消息，总是滚动到底部；对于AI回复，使用智能滚动
        if (role === 'user') {
        this.scrollToBottom();
                this.userScrolledUp = false; // 重置滚动状态
            } else {
                this.smartScrollToBottom();
            }
        }
        
        // 添加到指定聊天历史
        this.addToHistoryForChat(chatId, role, content);
        
        // 更新指定对话预览
        this.updateChatPreviewForChat(chatId);
    }
    
    createMessageElement(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = role === 'user' ? 'You' : 'AI';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        
                // 检查是否包含绘画选项
        if (role === 'assistant' && content.includes('DRAWING_OPTIONS:')) {
            this.renderDrawingOptions(textDiv, content);
        } else if (role === 'assistant' && content.includes('DRAWING_FINAL:')) {
            this.renderFinalDrawingPrompt(textDiv, content);
        } else if (role === 'assistant' && (content.includes('图片生成结果：') || content.includes('正在为您生成四张精美的图片') || content.includes('Image generation result:') || content.includes('Generating four beautiful images') || content.includes('All four different style images') || content.includes('Generating diverse images') || content.includes('task_id:') || content.includes('Preparing to generate'))) {
            this.renderImageGenerationMessage(textDiv, content);
        } else {
            // 渲染markdown
            const htmlContent = this.renderMarkdown(content);
            textDiv.innerHTML = htmlContent;
            
            // 对新添加的代码块进行语法高亮
            this.highlightCodeBlocks(textDiv);
            
            // 最后清理：移除DOM中多余的空白节点
            this.cleanupWhitespace(textDiv);
        }
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString();
        
        contentDiv.appendChild(textDiv);
        contentDiv.appendChild(timeDiv);
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(contentDiv);
        
        return messageDiv;
    }
    
    updateMessageContent(messageElement, content) {
        const textDiv = messageElement.querySelector('.message-text');
        if (textDiv) {
            // 检查是否包含绘画选项
            if (content.includes('DRAWING_OPTIONS:')) {
                this.renderDrawingOptions(textDiv, content);
            } else if (content.includes('DRAWING_FINAL:')) {
                this.renderFinalDrawingPrompt(textDiv, content);
            } else {
                // 渲染markdown
                const htmlContent = this.renderMarkdown(content);
                textDiv.innerHTML = htmlContent;
                
                // 对新添加的代码块进行语法高亮
                this.highlightCodeBlocks(textDiv);
                
                // 最后清理：移除DOM中多余的空白节点
                this.cleanupWhitespace(textDiv);
            }
        } else {
            console.error('找不到消息文本元素');
        }
        // 使用智能滚动，只在用户在底部时才滚动
        this.smartScrollToBottom();
    }
    
    renderFinalDrawingPrompt(textDiv, content) {
        // 为包含最终绘画提示的文本框添加特殊样式
        textDiv.classList.add('has-drawing-options');
        
        // 禁用之前所有的绘画选项
        this.disableAllPreviousDrawingOptions();
        
        // 分离文本和按钮文本
        const parts = content.split('DRAWING_FINAL:');
        const mainText = parts[0].trim();
        
        // 处理按钮文字 - 确保简洁
        let buttonText = 'Start Drawing';
        if (parts[1]) {
            const rawButtonText = parts[1].trim();
            // 如果按钮文字太长（超过20个字符），只使用默认文字
            if (rawButtonText.length > 0 && rawButtonText.length <= 20) {
                buttonText = rawButtonText;
            }
        }
        
        console.log('🎨 renderFinalDrawingPrompt - 按钮文字:', buttonText);
        console.log('🎨 renderFinalDrawingPrompt - 主文本长度:', mainText.length);
        
        // 清空原内容
        textDiv.innerHTML = '';
        
        // 添加主文本（包含prompt描述）
        if (mainText) {
            const textDiv_main = document.createElement('div');
            textDiv_main.innerHTML = this.renderMarkdown(mainText);
            textDiv_main.style.marginBottom = '16px';
            textDiv.appendChild(textDiv_main);
            
            // 对主文本中的代码块进行语法高亮
            this.highlightCodeBlocks(textDiv_main);
            
            // 清理空白节点
            this.cleanupWhitespace(textDiv_main);
        }
        
        // 创建最终绘画按钮容器
        const finalActionsContainer = document.createElement('div');
        finalActionsContainer.className = 'drawing-final-actions-container';
        
        // 开始绘画按钮 - 确保文字简洁
        const drawBtn = document.createElement('button');
        drawBtn.className = 'drawing-final-btn';
        drawBtn.textContent = `🎨 ${buttonText}`;
        drawBtn.addEventListener('click', () => {
            this.handleFinalDrawing(finalActionsContainer);
        });
        finalActionsContainer.appendChild(drawBtn);
        
        // 将容器添加到文本区域
        textDiv.appendChild(finalActionsContainer);
    }
    
    renderImageGenerationMessage(textDiv, content) {
        // 清理和解析内容
        const cleanContent = content.trim(); // 移除前后空白
        const lines = cleanContent.split('\n').map(line => line.trim()).filter(line => line.length > 0); // 移除空行
        
        // 找到状态行（第一个非空行）
        const statusLine = lines[0] || '正在生成图片...';
        
        // 添加调试信息
        console.log('🔍 原始内容:', JSON.stringify(content));
        console.log('🔍 清理后内容:', JSON.stringify(cleanContent));
        console.log('🔍 分割后的行:', lines);
        console.log('🔍 状态行:', statusLine);
        
        // 清空原内容
        textDiv.innerHTML = '';
        
        // 添加特殊类处理图片网格样式
        textDiv.classList.add('has-image-grid');
        
        // 添加状态文本
        const statusP = document.createElement('p');
        statusP.textContent = statusLine;
        textDiv.appendChild(statusP);
        
        // 创建图片网格
        const imageGrid = document.createElement('div');
        // 🆕 先设置基本类名，稍后根据实际情况调整
        imageGrid.className = 'image-grid';
        
        // Parse image URLs and prompts - support both Chinese and English formats
        const imageData = [];
        for (let i = 0; i < lines.length; i++) {
            // Support both Chinese "图片1:" and English "Image1:" formats
            if ((lines[i].startsWith('图片') || lines[i].toLowerCase().startsWith('image')) && lines[i].includes(':')) {
                const fullLine = lines[i];
                console.log(`🔍 Parsing image line: "${fullLine}"`);
                
                // Separate URL/status and prompt information
                // Format: 图片1: URL (prompt) or Image1: URL (prompt) or 图片1: status (prompt) or Image1: status (prompt)
                const match = fullLine.match(/^(?:图片|Image)\s*(\d+):\s*([^(]+)(?:\s*\(([^)]+)\))?/i);
                if (match) {
                    const index = parseInt(match[1]) - 1;
                    const urlOrStatus = match[2].trim();
                    let prompt = match[3] || '';
                    
                    // Clean up prompt - remove trailing '...' if truncated
                    if (prompt.endsWith('...')) {
                        prompt = prompt.slice(0, -3).trim();
                    }
                    
                    console.log(`🔍 Parse result - Image${index + 1}: URL/Status="${urlOrStatus}", Prompt="${prompt}"`);
                    
                    let status = 'pending';
                    let url = null;
                    
                    if (urlOrStatus.startsWith('/static/generated_images/')) {
                        status = 'completed';
                        url = urlOrStatus;
                    } else if (urlOrStatus === 'failed') {
                        status = 'failed';
                    } else if (urlOrStatus === 'generating') {
                        status = 'generating';
                        console.log(`🔍 设置为generating状态: Image${index + 1}`);
                    } else if (urlOrStatus === 'pending') {
                        status = 'pending';
                        console.log(`🔍 设置为pending状态: Image${index + 1}`);
                    } else {
                        status = 'pending';
                        console.log(`🔍 默认设置为pending状态: Image${index + 1}, urlOrStatus="${urlOrStatus}"`);
                    }
                    
                    imageData[index] = {
                        status: status,
                        url: url,
                        prompt: prompt
                    };
                }
            }
        }
        
        // 确保总是有4张图片的位置
        while (imageData.length < 4) {
            imageData.push({
                status: statusLine.includes('全部生成完成') || statusLine.includes('生成完成') ? 'failed' : 'pending',
                url: null,
                prompt: ''
            });
        }
        
        console.log('🔍 最终解析结果:', imageData);
        
        // 创建4个图片占位符
        for (let i = 0; i < 4; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'image-placeholder';
            placeholder.setAttribute('data-index', i);
            
            const imgData = imageData[i] || { status: 'pending', url: null, prompt: '' };
            
            // 🔍 Debug: 记录每个图片的状态
            console.log(`🔍 Image${i + 1} final status:`, imgData.status, ', URL:', imgData.url);
            
            // Ensure we have a valid prompt, use fallback if needed
            let finalPrompt = imgData.prompt || '';
            if (!finalPrompt && imgData.url && imgData.status === 'completed') {
                // If no prompt but image exists, create a basic fallback prompt
                finalPrompt = `Generated artwork style ${i + 1}, high quality, detailed`;
                console.log(`🔍 Using fallback prompt for Image${i + 1}:`, finalPrompt);
            }
            
            const shortPrompt = finalPrompt && finalPrompt.length > 50 ? 
                finalPrompt.substring(0, 50) + '...' : finalPrompt;
            
            if (imgData.url && imgData.status === 'completed') {
                // 已完成的图片
                console.log(`🔍 Image${i + 1} 渲染为已完成`);
                placeholder.innerHTML = `
                    <img src="${imgData.url}" alt="Generated Image ${i + 1}" class="generated-image" title="${finalPrompt}" data-full-prompt="${finalPrompt}">
                    ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                `;
                placeholder.classList.add('completed');
                placeholder.setAttribute('data-full-prompt', finalPrompt);
            } else if (imgData.status === 'failed') {
                // 生成失败
                console.log(`🔍 Image${i + 1} 渲染为失败`);
                placeholder.innerHTML = `
                    <div class="error-indicator">❌</div>
                    <p>Generation Failed</p>
                    ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                `;
                placeholder.classList.add('failed');
                placeholder.setAttribute('data-full-prompt', finalPrompt);
            } else if (imgData.status === 'generating') {
                // 正在生成中
                console.log(`🔍 Image${i + 1} 渲染为正在生成`);
                placeholder.innerHTML = `
                    <div class="loading-spinner"></div>
                    <p>Generating...</p>
                    ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                `;
                placeholder.classList.add('generating');
                placeholder.setAttribute('data-full-prompt', finalPrompt);
            } else {
                // 其他状态（pending）- 对于历史记录，显示为未完成
                console.log(`🔍 Image${i + 1} 渲染为未完成 (${imgData.status})`);
                placeholder.innerHTML = `
                    <div class="waiting-indicator">⏳</div>
                    <p>Pending</p>
                    ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                `;
                placeholder.classList.add('pending');
                placeholder.setAttribute('data-full-prompt', finalPrompt);
            }
            
            imageGrid.appendChild(placeholder);
        }
        
        textDiv.appendChild(imageGrid);
        
        // 🆕 根据实际情况决定网格状态
        const completedCount = imageData.filter(img => img.status === 'completed').length;
        const hasIncomplete = imageData.some(img => img.status === 'generating' || img.status === 'pending');
        
        // 🔍 Debug: 网格状态判断
        console.log('🔍 网格状态判断:', {
            completedCount,
            hasIncomplete,
            statusLine,
            imageData: imageData.map(img => ({status: img.status, url: img.url}))
        });

        // 关键修复：我们不仅要看消息内容，还要检查全局状态
        const isThisTheActiveTask = (this.preparingGeneration || this.currentTaskId) && this.generationChatId === this.currentChatId;

        // 检查消息内容本身是否表示一个已完成的状态
        const hasActiveTaskInContent = content.includes('task_id:') && hasIncomplete;
        const isFullyCompleted = !hasIncomplete && !hasActiveTaskInContent && completedCount > 0 && 
                                (statusLine.includes('🎉') || statusLine.includes('✅') || 
                                 statusLine.includes('successfully') || statusLine.includes('completed'));
        
        if (isThisTheActiveTask) {
            // 只有当这是一个真正活跃的任务时，才添加 .active
            imageGrid.classList.add('active');
            console.log('🔍 标记为活跃任务，因为当前有正在进行的生成任务');
        } else if (isFullyCompleted) {
            // 如果任务明确完成了，标记为历史
            imageGrid.classList.add('historical');
            console.log('🔍 标记为历史记录：图片生成已完成');
        } else {
            // 对于所有其他情况（包括历史记录中的未完成/pending任务），都标记为历史
            imageGrid.classList.add('historical');
            console.log('🔍 标记为历史记录：这是一个被遗弃的、未完成的任务');
        }
        
        // 如果有已完成的图片，添加操作按钮
        if (completedCount > 0) {
            // 为历史记录创建操作按钮
            const messageBubble = textDiv.closest('.message');
            if (messageBubble && !messageBubble.querySelector('.image-action-buttons')) {
                // 🆕 对于未完成的任务，保留引用；对于已完成的任务，临时设置引用
                if (hasIncomplete || hasActiveTask) {
                    // 如果有未完成的图片或活跃任务，这可能是需要恢复的任务，保留引用
                    console.log('🔧 为可能需要恢复的任务保留UI引用');
                    this.currentImageGrid = imageGrid;
                    this.currentImageBubble = messageBubble;
                    this.addImageActionButtons();
                } else {
                    // 对于已完成的任务，临时设置引用
                    const originalGrid = this.currentImageGrid;
                    const originalBubble = this.currentImageBubble;
                    
                    this.currentImageGrid = imageGrid;
                    this.currentImageBubble = messageBubble;
                    
                    // 添加按钮
                    this.addImageActionButtons();
                    
                    // 恢复原始引用
                    this.currentImageGrid = originalGrid;
                    this.currentImageBubble = originalBubble;
                }
            }
        }
    }
    
    renderDrawingOptions(textDiv, content) {
        // 为包含绘画选项的文本框添加特殊样式
        textDiv.classList.add('has-drawing-options');
        
        // 禁用之前所有的绘画选项
        this.disableAllPreviousDrawingOptions();
        
        // 分离文本和选项
        const parts = content.split('DRAWING_OPTIONS:');
        const mainText = parts[0].trim();
        const optionsText = parts[1] ? parts[1].trim() : '';
        
        // 清空原内容
        textDiv.innerHTML = '';
        
        // 添加主文本
        if (mainText) {
            const textDiv_main = document.createElement('div');
            textDiv_main.innerHTML = this.renderMarkdown(mainText);
            textDiv_main.style.marginBottom = '12px';
            textDiv.appendChild(textDiv_main);
            
            // 对主文本中的代码块进行语法高亮
            this.highlightCodeBlocks(textDiv_main);
            
            // 清理空白节点
            this.cleanupWhitespace(textDiv_main);
        }
        
        // 解析选项
        if (optionsText) {
            const options = optionsText.split('|').map(opt => opt.trim());
            
            // 创建选项容器
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'drawing-options-container';
            
            // 存储选中的选项
            const selectedOptions = new Set();
            
            // 创建四个选项按钮
            options.forEach((option, index) => {
                const optionBtn = document.createElement('button');
                optionBtn.className = 'drawing-option-btn';
                optionBtn.textContent = option;
                optionBtn.dataset.option = option;
                optionBtn.addEventListener('click', () => {
                    this.toggleOptionSelection(optionBtn, selectedOptions, actionsContainer);
                });
                optionsContainer.appendChild(optionBtn);
            });
            
            // 创建操作按钮容器
            const actionsContainer = document.createElement('div');
            actionsContainer.className = 'drawing-actions-container';
            
            // 确认选择按钮
            const createBtn = document.createElement('button');
            createBtn.className = 'drawing-create-btn disabled';
            createBtn.textContent = '✅ Confirm Selection';
            createBtn.disabled = true;
            createBtn.addEventListener('click', () => {
                if (selectedOptions.size > 0) {
                    this.handleDrawingStart(Array.from(selectedOptions), optionsContainer);
                }
            });
            actionsContainer.appendChild(createBtn);
            
            // 继续完善按钮
            const refineBtn = document.createElement('button');
            refineBtn.className = 'drawing-refine-btn disabled';
            refineBtn.textContent = '✨ Refine Further';
            refineBtn.disabled = true;
            refineBtn.addEventListener('click', () => {
                if (selectedOptions.size > 0) {
                    this.handleDrawingRefine(Array.from(selectedOptions), optionsContainer);
                }
            });
            actionsContainer.appendChild(refineBtn);
            
            // 重新生成按钮
            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'drawing-reject-btn';
            rejectBtn.textContent = '🔄 Regenerate';
            rejectBtn.addEventListener('click', () => {
                this.handleDrawingReject(optionsContainer);
            });
            actionsContainer.appendChild(rejectBtn);
            
            // 将容器添加到文本区域
            textDiv.appendChild(optionsContainer);
            textDiv.appendChild(actionsContainer);
        }
    }
    
    toggleOptionSelection(optionBtn, selectedOptions, actionsContainer) {
        const option = optionBtn.dataset.option;
        
        if (selectedOptions.has(option)) {
            // 取消选择
            selectedOptions.delete(option);
            optionBtn.classList.remove('selected');
        } else {
            // 选择
            selectedOptions.add(option);
            optionBtn.classList.add('selected');
        }
        
        // 更新操作按钮状态
        this.updateActionButtons(selectedOptions, actionsContainer);
    }
    
    updateActionButtons(selectedOptions, actionsContainer) {
        const createBtn = actionsContainer.querySelector('.drawing-create-btn');
        const refineBtn = actionsContainer.querySelector('.drawing-refine-btn');
        
        const hasSelection = selectedOptions.size > 0;
        
        if (hasSelection) {
            createBtn.disabled = false;
            createBtn.classList.remove('disabled');
            refineBtn.disabled = false;
            refineBtn.classList.remove('disabled');
        } else {
            createBtn.disabled = true;
            createBtn.classList.add('disabled');
            refineBtn.disabled = true;
            refineBtn.classList.add('disabled');
        }
    }
    
    handleDrawingStart(selectedOptions, container) {
        // Lock option states
        this.lockDrawingOptions(container, selectedOptions);
        
        // 🎯 Correct flow: After confirming selection, let AI generate summary text instead of starting drawing directly
        const selectedText = selectedOptions.length === 1 ? 
            `${selectedOptions[0]}` : 
            `${selectedOptions.join(', ')}`;
        
        // Send confirmation message asking AI to generate summary text and meta prompt
        const confirmMessage = `I confirm my selection: ${selectedText}. Please generate a complete and detailed drawing prompt description based on all my previous choices and provide the option to start drawing.`;
        this.simulateUserMessage(confirmMessage);
    }
    
    handleDrawingRefine(selectedOptions, container) {
        // Lock option states
        this.lockDrawingOptions(container, selectedOptions);
        
        // Send refinement request to backend
        const selectedText = selectedOptions.length === 1 ? 
            `"${selectedOptions[0]}"` : 
            `these styles: "${selectedOptions.join('", "')}"`;
        const refineMessage = `I selected ${selectedText}, please continue to provide more detailed options to refine the creative concept based on this selection`;
        this.simulateUserMessage(refineMessage);
    }
    
    handleDrawingReject(container) {
        // Send regeneration request
        const rejectMessage = 'Regenerate four different style options';
        this.simulateUserMessage(rejectMessage);
    }
    
    handleFinalDrawing(container) {
        // Disable button and show status
        const drawBtn = container.querySelector('.drawing-final-btn');
        if (drawBtn) {
            drawBtn.disabled = true;
            drawBtn.textContent = '🎨 Drawing...';
            drawBtn.classList.add('disabled');
        }
        
        // Create new image display bubble 绑定到当前对话
        const targetChatId = this.currentChatId;
        this.createImageGenerationBubble(targetChatId);
        
        // 🆕 标记正在准备生成任务
        this.preparingGeneration = true;
        this.generationChatId = targetChatId;
        
        // Simplified logic: directly find the AI message containing the "Start Drawing" button and send complete content to backend
        let targetMessage = null;
        const assistantMessages = this.messagesContainer.querySelectorAll('.message.assistant');
        
        // 从后往前找包含绘画按钮的消息
        for (let i = assistantMessages.length - 1; i >= 0; i--) {
            const message = assistantMessages[i];
            if (message.querySelector('.drawing-final-btn')) {
                targetMessage = message;
                break;
            }
        }
        
        // If not found, use the last AI message
        const lastAiMessage = targetMessage || this.messagesContainer.querySelector('.message.assistant:last-child');
        let fullAIResponse = '';
        
        if (lastAiMessage) {
            // Get complete AI reply content, remove DRAWING_FINAL marker
            fullAIResponse = lastAiMessage.textContent.replace(/DRAWING_FINAL:[^]*$/, '').trim();
            console.log('🎨 Sending complete AI reply to backend for intelligent diversity generation:', fullAIResponse);
        }
        
        // If no suitable AI reply found, use default content
        if (!fullAIResponse) {
            fullAIResponse = 'User wants to generate a beautiful artwork, high quality, detailed, masterpiece level.';
            console.log('🎨 Using default content');
        }
        
        // Start image generation - directly pass complete AI reply for backend intelligent processing
        this.startImageGeneration(fullAIResponse);
        
        // 🎯 Save complete meta prompt for regeneration
        this.lastMetaPrompt = fullAIResponse;
    }
    
    createImageGenerationBubble(targetChatId = null) {
        // 使用目标对话ID，默认为当前对话
        const chatId = targetChatId || this.currentChatId;
        
        // 🚨 重要：只有当目标对话是当前显示的对话时，才在UI中显示气泡
        const shouldShowInUI = (chatId === this.currentChatId);
        
        console.log('🎨 Creating image generation bubble', {
            targetChatId: chatId,
            currentChatId: this.currentChatId,
            showInUI: shouldShowInUI
        });
        
        // Create new message element using standard AI message structure
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        messageDiv.setAttribute('data-chat-id', chatId); // 🎯 标记气泡属于哪个对话
        messageDiv.innerHTML = `<div class="message-avatar">🤖</div><div class="message-content"><div class="message-text has-image-grid"><p>Preparing to generate diverse images... (Pending)</p><div class="image-grid active" id="image-grid-${Date.now()}"><div class="image-placeholder" data-index="0"><div class="waiting-indicator">⏳</div><p>Pending...</p></div><div class="image-placeholder" data-index="1"><div class="waiting-indicator">⏳</div><p>Pending...</p></div><div class="image-placeholder" data-index="2"><div class="waiting-indicator">⏳</div><p>Pending...</p></div><div class="image-placeholder" data-index="3"><div class="waiting-indicator">⏳</div><p>Pending...</p></div></div></div><div class="message-time">${new Date().toLocaleTimeString()}</div></div>`;
        
        // 只有当前对话才添加到UI中
        if (shouldShowInUI) {
            this.messagesContainer.appendChild(messageDiv);
            this.scrollToBottom();
        }
        
        // 始终添加到对话历史记录中
        this.addToHistoryForChat(chatId, 'assistant', 'Preparing to generate diverse images... (Pending)');
        
        // 只有当前对话才保存UI引用
        if (shouldShowInUI) {
            this.currentImageGrid = messageDiv.querySelector('.image-grid');
            this.currentImageBubble = messageDiv;
        }
        
        return messageDiv;
    }
    
    async startImageGeneration(prompt) {
        // Ensure only active image grid can start generation
        if (!this.currentImageGrid || this.currentImageGrid.classList.contains('historical')) {
            console.log('⚠️ Preventing historical records from triggering image generation');
            return;
        }
        
        try {
            console.log('🎨 Starting image generation, prompt:', prompt);
            
            // 发送图片生成请求
            const response = await fetch('/api/generate_images', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    chat_id: this.generationChatId
                })
            });
            
            if (!response.ok) {
                throw new Error('Image generation request failed');
            }
            
            const data = await response.json();
            this.currentTaskId = data.task_id;
            this.generationStartTime = Date.now(); // Record start time
            this.preparingGeneration = false; // 🆕 准备阶段结束，正式开始生成
            
            console.log('🎨 Image generation task started, task ID:', this.currentTaskId, 'chat ID:', this.generationChatId);
            
            // Start polling image generation status
            this.pollImageGeneration();
            
        } catch (error) {
            console.error('Image generation error:', error);
            this.preparingGeneration = false; // 🆕 出错时清除准备状态
            this.showImageGenerationError('Failed to start image generation, please try again later.');
        }
    }
    
    async pollImageGeneration() {
        if (!this.currentTaskId) return;
        
        // Check if still in the original chat of the generation task
        if (this.generationChatId && this.currentChatId !== this.generationChatId) {
            console.log('🚫 Current chat ID does not match generation task chat ID, stopping UI updates', {
                current: this.currentChatId,
                generation: this.generationChatId
            });
            // Clear frontend polling timer
            if (this.pollingTimerId) {
                clearTimeout(this.pollingTimerId);
                this.pollingTimerId = null;
            }
            // Continue polling task status but don't update UI, let task complete in background
            if (this.backgroundPollingTimerId) {
                clearTimeout(this.backgroundPollingTimerId);
            }
            this.backgroundPollingTimerId = setTimeout(() => this.pollImageGenerationBackground(), 2000);
            return;
        }
        
        // Check if timeout (5 minutes)
        if (this.generationStartTime && Date.now() - this.generationStartTime > 5 * 60 * 1000) {
            this.showImageGenerationError('Image generation timeout, please retry.');
            this.currentTaskId = null;
            this.generationChatId = null;
            return;
        }
        
        try {
            const response = await fetch(`/api/generate_images/${this.currentTaskId}`);
            
            if (!response.ok) {
                throw new Error('Failed to get generation status');
            }
            
            const data = await response.json();
            
            // Update image status
            this.updateImageGrid(data.images);
            
            // Check if there are still tasks in progress
            const hasGenerating = data.images.some(img => img.status === 'generating');
            const hasPending = data.images.some(img => img.status === 'pending');
            const completedCount = data.images.filter(img => img.status === 'completed').length;
            const failedCount = data.images.filter(img => img.status === 'failed').length;
            
            // If there are still images generating or pending, continue polling
            if (hasGenerating || hasPending) {
                // Clear previous timer
                if (this.pollingTimerId) {
                    clearTimeout(this.pollingTimerId);
                }
                // 设置新的定时器
                this.pollingTimerId = setTimeout(() => this.pollImageGeneration(), 2000);
            } 
            // 如果所有任务都完成了（无论成功还是失败）
            else if (completedCount + failedCount === 4) {
                // 清理定时器
                if (this.pollingTimerId) {
                    clearTimeout(this.pollingTimerId);
                    this.pollingTimerId = null;
                }
                
                if (completedCount === 0) {
                    // 如果没有一张成功，显示错误
                    this.showImageGenerationError('All image generation failed. Please try again.');
                } else {
                    // 有部分成功，显示最终状态
                    this.finishImageGeneration(completedCount, failedCount);
                }
            }
            
        } catch (error) {
            console.error('轮询图片生成状态错误:', error);
            // 清理之前的定时器
            if (this.pollingTimerId) {
                clearTimeout(this.pollingTimerId);
            }
            // 设置新的定时器，出错后延长重试间隔
            this.pollingTimerId = setTimeout(() => this.pollImageGeneration(), 5000);
        }
    }
    
    async pollImageGenerationBackground() {
        if (!this.currentTaskId) return;
        
        // 检查是否超时（5分钟）
        if (this.generationStartTime && Date.now() - this.generationStartTime > 5 * 60 * 1000) {
            console.log('🕐 后台图片生成任务超时');
            this.currentTaskId = null;
            this.generationChatId = null;
            return;
        }
        
        try {
            const response = await fetch(`/api/generate_images/${this.currentTaskId}`);
            
            if (!response.ok) {
                throw new Error('获取生成状态失败');
            }
            
            const data = await response.json();
            
            // 🆕 每次都更新聊天历史，确保状态同步
            this.updateBackgroundTaskHistory(data.images, data.images.filter(img => img.status === 'completed').length, data.images.filter(img => img.status === 'failed').length);
            
            // 检查是否还有任务正在进行
            const hasGenerating = data.images.some(img => img.status === 'generating');
            const hasPending = data.images.some(img => img.status === 'pending');
            const completedCount = data.images.filter(img => img.status === 'completed').length;
            const failedCount = data.images.filter(img => img.status === 'failed').length;
            
            // 如果还有图片在生成中或等待中，继续后台轮询
            if (hasGenerating || hasPending) {
                console.log('🔄 后台任务继续进行中...', {completedCount, failedCount});
                // 清理之前的后台定时器
                if (this.backgroundPollingTimerId) {
                    clearTimeout(this.backgroundPollingTimerId);
                }
                // 设置新的后台定时器
                this.backgroundPollingTimerId = setTimeout(() => this.pollImageGenerationBackground(), 2000);
            } 
            // 如果所有任务都完成了，清理任务状态
            else if (completedCount + failedCount === 4) {
                console.log('✅ 后台任务完成，清理任务状态', {completedCount, failedCount});
                // 清理后台定时器
                if (this.backgroundPollingTimerId) {
                    clearTimeout(this.backgroundPollingTimerId);
                    this.backgroundPollingTimerId = null;
                }
                this.currentTaskId = null;
                this.generationChatId = null;
            }
            
        } catch (error) {
            console.error('后台轮询图片生成状态错误:', error);
            // 清理之前的后台定时器
            if (this.backgroundPollingTimerId) {
                clearTimeout(this.backgroundPollingTimerId);
            }
            // 设置新的后台定时器，出错后延长重试间隔
            this.backgroundPollingTimerId = setTimeout(() => this.pollImageGenerationBackground(), 5000);
        }
    }
    
    updateBackgroundTaskHistory(images, completedCount, failedCount) {
        // Update original chat history
        const generationChat = this.chats[this.generationChatId];
        if (generationChat && generationChat.messages.length > 0) {
            // Find and update image generation message - support both Chinese and English
            for (let i = generationChat.messages.length - 1; i >= 0; i--) {
                if (generationChat.messages[i].role === 'assistant' && 
                    (generationChat.messages[i].content.includes('正在为您生成四张精美的图片') ||
                     generationChat.messages[i].content.includes('图片生成结果：') ||
                     generationChat.messages[i].content.includes('Generating four beautiful images') ||
                     generationChat.messages[i].content.includes('Image generation result:') ||
                     generationChat.messages[i].content.includes('All four different style images') ||
                     generationChat.messages[i].content.includes('Preparing to generate') ||
                     generationChat.messages[i].content.includes('task_id:'))) {
                    
                    // 🆕 根据实际状态生成状态文本
                    const generatingCount = images.filter(img => img.status === 'generating').length;
                    const pendingCount = images.filter(img => img.status === 'pending').length;
                    
                    let finalStatusText = '';
                    if (completedCount === 4) {
                        finalStatusText = '🎉 All four different style images have been generated successfully!';
                    } else if (completedCount + failedCount === 4) {
                        finalStatusText = `✅ Image generation completed! Successfully generated ${completedCount} images${failedCount > 0 ? `, ${failedCount} failed` : ''}.`;
                    } else if (generatingCount > 0 || pendingCount > 0) {
                        finalStatusText = `Generating diverse images... (Completed: ${completedCount}/4, Generating: ${generatingCount}, Pending: ${pendingCount}${failedCount > 0 ? `, Failed: ${failedCount}` : ''})`;
                    } else {
                        finalStatusText = `Preparing diverse images... (Completed: ${completedCount}/4${failedCount > 0 ? `, Failed: ${failedCount}` : ''})`;
                    }
                    
                    // Build complete content containing image information - use English format
                    let imageContent = finalStatusText.trim() + '\n\nImage generation result:\n';
                    
                    // If there's a task ID, add it to content
                    if (this.currentTaskId) {
                        imageContent += `task_id: ${this.currentTaskId}\n`;
                    }
                    
                    images.forEach((img, index) => {
                        if (img.status === 'completed' && img.url) {
                            // Include prompt information for proper rendering
                            const promptInfo = img.prompt ? ` (${img.prompt.substring(0, 100)}${img.prompt.length > 100 ? '...' : ''})` : '';
                            imageContent += `Image${index + 1}: ${img.url}${promptInfo}\n`;
                        } else {
                            // Even if status is not completed, save prompt information
                            const promptInfo = img.prompt ? ` (${img.prompt.substring(0, 100)}${img.prompt.length > 100 ? '...' : ''})` : '';
                            imageContent += `Image${index + 1}: ${img.status}${promptInfo}\n`;
                            // 🔍 Debug: 记录保存的状态
                            console.log(`🔍 保存图片状态到聊天历史 - Image${index + 1}:`, img.status, ', Prompt:', img.prompt);
                        }
                    });
                    
                    // Clean up trailing blank lines
                    imageContent = imageContent.trim();
                    
                    generationChat.messages[i].content = imageContent;
                    this.saveToStorage();
                    console.log('📝 Background task history updated with current status');
                    break;
                }
            }
        }
    }
    
    finishImageGeneration(completedCount, failedCount) {
        // 🚨 重要：只有当生成任务的对话与当前显示的对话一致时才更新UI
        if (this.generationChatId && this.generationChatId !== this.currentChatId) {
            console.log('🚫 Skipping UI finish update: generation chat ID does not match current chat ID', {
                generationChatId: this.generationChatId,
                currentChatId: this.currentChatId
            });
            // 但是仍然需要清理任务状态
            this.currentTaskId = null;
            this.generationChatId = null;
            this.preparingGeneration = false; // 🆕 清理准备状态
            if (this.pollingTimerId) {
                clearTimeout(this.pollingTimerId);
                this.pollingTimerId = null;
            }
            if (this.backgroundPollingTimerId) {
                clearTimeout(this.backgroundPollingTimerId);
                this.backgroundPollingTimerId = null;
            }
            return;
        }
        
        // Generation completed, update final status
        let finalStatusText = '';
        if (this.currentImageBubble) {
            const statusText = this.currentImageBubble.querySelector('.message-text p');
            if (statusText) {
                if (completedCount === 4) {
                    finalStatusText = '🎉 All four different style images have been generated successfully!';
                } else if (completedCount > 0) {
                    finalStatusText = `✅ Image generation completed! Successfully generated ${completedCount} images${failedCount > 0 ? `, ${failedCount} failed` : ''}.`;
                }
                // Clean up status text to ensure no extra whitespace
                statusText.textContent = finalStatusText.trim();
            }
            
            // Add action buttons (only when there are successfully generated images)
            if (completedCount > 0) {
                this.addImageActionButtons();
            }
        }
        
        // Manually update chat history to ensure final status is saved
        if (finalStatusText && this.currentImageGrid) {
            const images = [];
            for (let i = 0; i < 4; i++) {
                const placeholder = this.currentImageGrid.querySelector(`[data-index="${i}"]`);
                if (placeholder) {
                    const img = placeholder.querySelector('img');
                    if (img && img.src) {
                        // Extract relative path
                        const url = img.src.replace(window.location.origin, '');
                        images.push({status: 'completed', url: url});
                    } else if (placeholder.classList.contains('failed')) {
                        images.push({status: 'failed', url: null});
                    } else {
                        images.push({status: 'pending', url: null});
                    }
                }
            }
            
            // Force update chat history
            this.updateChatHistoryImageStatus(finalStatusText, images);
        }
        
        // Clear current task ID and chat ID to prevent continued polling
        this.currentTaskId = null;
        this.generationChatId = null;
        this.preparingGeneration = false; // 🆕 清理准备状态
        
        // Clean up all timers
        if (this.pollingTimerId) {
            clearTimeout(this.pollingTimerId);
            this.pollingTimerId = null;
        }
        if (this.backgroundPollingTimerId) {
            clearTimeout(this.backgroundPollingTimerId);
            this.backgroundPollingTimerId = null;
        }
        
        console.log(`Image generation task completed: ${completedCount} successful, ${failedCount} failed`);
    }
    
    addImageActionButtons() {
        // Check if buttons have already been added
        if (this.currentImageBubble.querySelector('.image-action-buttons')) {
            return;
        }
        
        // Make all completed images selectable
        this.enableDirectImageSelection();
        
        // Create button container
        const actionContainer = document.createElement('div');
        actionContainer.className = 'image-action-buttons';
        
        // Continue creating button (disabled by default)
        const continueBtn = document.createElement('button');
        continueBtn.className = 'image-action-btn continue-btn disabled';
        continueBtn.textContent = '🎨 Continue Creating';
        continueBtn.disabled = true;
        continueBtn.onclick = () => this.handleContinueCreationDirect();
        actionContainer.appendChild(continueBtn);
        
        // Regenerate button (always available)
        const regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'image-action-btn regenerate-btn';
        regenerateBtn.textContent = '🔄 Regenerate';
        regenerateBtn.onclick = () => this.handleRegenerateImages();
        actionContainer.appendChild(regenerateBtn);
        
        // Zoom view button (disabled by default)
        const zoomBtn = document.createElement('button');
        zoomBtn.className = 'image-action-btn zoom-btn disabled';
        zoomBtn.textContent = '🔍 Zoom View';
        zoomBtn.disabled = true;
        zoomBtn.onclick = () => this.handleImageZoomDirect();
        actionContainer.appendChild(zoomBtn);
        
        // Add to message bubble
        const messageText = this.currentImageBubble.querySelector('.message-text');
        messageText.appendChild(actionContainer);
        
        // Store currently selected image index
        this.selectedImageIndex = null;
    }
    
    enableDirectImageSelection() {
        if (!this.currentImageGrid) return;
        
        // Add click selection functionality for all completed images
        const placeholders = this.currentImageGrid.querySelectorAll('.image-placeholder.completed');
        placeholders.forEach((placeholder, actualIndex) => {
            // Get the actual image index
            const imageIndex = parseInt(placeholder.getAttribute('data-index'));
            
            placeholder.classList.add('image-selectable-direct');
            placeholder.style.cursor = 'pointer';
            
            placeholder.onclick = () => {
                this.selectImageDirect(imageIndex);
            };
        });
    }
    
    selectImageDirect(imageIndex) {
        if (!this.currentImageGrid) return;
        
        // Clear selection state for all images
        const allPlaceholders = this.currentImageGrid.querySelectorAll('.image-placeholder');
        allPlaceholders.forEach(p => {
            p.classList.remove('selected-direct');
        });
        
        // Select current image
        const selectedPlaceholder = this.currentImageGrid.querySelector(`[data-index="${imageIndex}"]`);
        if (selectedPlaceholder && selectedPlaceholder.classList.contains('completed')) {
            selectedPlaceholder.classList.add('selected-direct');
            this.selectedImageIndex = imageIndex;
            
            // Activate related buttons
            this.updateButtonStates(true);
            
            console.log('Image selected:', imageIndex);
        }
    }
    
    updateButtonStates(hasSelection) {
        if (!this.currentImageBubble) return;
        
        const continueBtn = this.currentImageBubble.querySelector('.continue-btn');
        const zoomBtn = this.currentImageBubble.querySelector('.zoom-btn');
        
        if (hasSelection) {
            // Activate buttons when there's a selection
            if (continueBtn) {
                continueBtn.classList.remove('disabled');
                continueBtn.disabled = false;
            }
            if (zoomBtn) {
                zoomBtn.classList.remove('disabled');
                zoomBtn.disabled = false;
            }
        } else {
            // Disable buttons when there's no selection
            if (continueBtn) {
                continueBtn.classList.add('disabled');
                continueBtn.disabled = true;
            }
            if (zoomBtn) {
                zoomBtn.classList.add('disabled');
                zoomBtn.disabled = true;
            }
        }
    }
    
    handleContinueCreationDirect() {
        if (this.selectedImageIndex === null) return;
        
        // Get prompt information for selected image
        const selectedPlaceholder = this.currentImageGrid.querySelector(`[data-index="${this.selectedImageIndex}"]`);
        if (selectedPlaceholder) {
            // Try multiple ways to get the prompt
            let fullPrompt = selectedPlaceholder.getAttribute('data-full-prompt') || '';
            
            // If not found on placeholder, try to get from img element
            if (!fullPrompt) {
                const imgElement = selectedPlaceholder.querySelector('img');
                if (imgElement) {
                    fullPrompt = imgElement.getAttribute('data-full-prompt') || imgElement.title || '';
                }
            }
            
            // If still not found, try to extract from the original chat message
            if (!fullPrompt) {
                console.log('🔍 Prompt not found in data-full-prompt, trying to extract from chat history...');
                fullPrompt = this.extractPromptFromChatHistory(this.selectedImageIndex);
            }
            
            // Debug information
            console.log('🔍 Selected image index:', this.selectedImageIndex);
            console.log('🔍 Selected placeholder:', selectedPlaceholder);
            console.log('🔍 Placeholder data-full-prompt:', selectedPlaceholder.getAttribute('data-full-prompt'));
            console.log('🔍 Final prompt:', fullPrompt);
            
            if (fullPrompt && fullPrompt.trim()) {
                console.log('Continue creating selected image, prompt:', fullPrompt);
                this.processSelectedImageDirect(fullPrompt);
            } else {
                // Final fallback: use a generic prompt based on the selected image
                const fallbackPrompt = `Continue creating artwork in a similar style to the selected image ${this.selectedImageIndex + 1}, high quality, detailed, masterpiece level artwork`;
                console.log('🔍 Using final fallback prompt:', fallbackPrompt);
                
                this.showModal('Notice', 'Using a generic prompt as specific style information was not found. The AI will analyze the selected image to continue creation.', 'info', () => {
                    this.processSelectedImageDirect(fallbackPrompt);
                });
            }
        }
    }
    
    handleImageZoomDirect() {
        if (this.selectedImageIndex === null) return;
        
        // Get information for selected image
        const selectedPlaceholder = this.currentImageGrid.querySelector(`[data-index="${this.selectedImageIndex}"]`);
        if (selectedPlaceholder && selectedPlaceholder.classList.contains('completed')) {
            const img = selectedPlaceholder.querySelector('img');
            if (img) {
                const fullPrompt = selectedPlaceholder.getAttribute('data-full-prompt') || img.title || '';
                const imageData = {
                    src: img.src,
                    alt: img.alt,
                    prompt: fullPrompt,
                    index: this.selectedImageIndex
                };
                
                // Show single image viewer
                this.showSingleImageViewer(imageData);
            }
        }
    }
    
    async processSelectedImageDirect(selectedPrompt) {
        try {
            console.log('User selected image prompt:', selectedPrompt);
            
            // 🎯 Use streaming call to build specialized style analysis request
            const analysisRequest = `I selected this image to continue creating, its description is:

"${selectedPrompt}"

Please analyze my style preferences as a professional AI drawing assistant with a warm and friendly tone.

**Response Requirements:**
1. Start with an expression like "Ah~ I see you prefer this XXX style!" to show understanding and resonance with my choice
2. Then analyze the characteristics of this style in detail from aspects like visual style, color features, composition elements, etc.
3. Based on these style characteristics, provide me with 4 more detailed related creative directions
4. Use the standard selection format: DRAWING_OPTIONS:Option1|Option2|Option3|Option4

Please make me feel that you truly understand my artistic preferences!`;

            // 📝 Add user's selection as user message to history
            this.addToHistoryForChat(this.currentChatId, 'user', `I selected this image to continue creating: ${selectedPrompt}`);
            
            // 🌊 Use streaming call to handle AI analysis
            await this.sendMessageInternal(analysisRequest, false); // false means don't show user message bubble
            
        } catch (error) {
            console.error('Error processing selected image:', error);
            this.showModal('Error', 'Style analysis failed, please try again later', 'error');
        }
    }
    
    extractPromptFromChatHistory(imageIndex) {
        // Try to extract prompt information from chat history
        const chat = this.chats[this.currentChatId];
        if (!chat || !chat.messages) return '';
        
        // Look for the most recent image generation message
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const message = chat.messages[i];
            if (message.role === 'assistant' && 
                (message.content.includes('Image generation result:') ||
                 message.content.includes('All four different style images') ||
                 message.content.includes('task_id:'))) {
                
                const lines = message.content.split('\n');
                console.log('🔍 Analyzing chat history message:', lines);
                
                // Look for the specific image line
                for (let line of lines) {
                    const imageRegex = new RegExp(`Image${imageIndex + 1}:\\s*([^\\(]+)(?:\\s*\\(([^\\)]+)\\))?`, 'i');
                    const match = line.match(imageRegex);
                    
                    if (match) {
                        const url = match[1] ? match[1].trim() : '';
                        const prompt = match[2] ? match[2].trim() : '';
                        
                        console.log(`🔍 Found Image${imageIndex + 1} in chat history:`, {url, prompt});
                        
                        // Only return if it's a valid URL (not a status like 'failed')
                        if (url.startsWith('/static/generated_images/') && prompt) {
                            // Handle truncated prompts (ending with ...)
                            if (prompt.endsWith('...')) {
                                console.log('🔍 Prompt appears to be truncated, using available portion');
                                return prompt.slice(0, -3); // Remove the '...'
                            }
                            return prompt;
                        }
                    }
                }
            }
        }
        
        console.log('🔍 No prompt found in chat history for image index:', imageIndex);
        
        // As a last resort, try to get the basic prompt from recent AI messages about image generation
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const message = chat.messages[i];
            if (message.role === 'assistant' && 
                (message.content.includes('画风') || message.content.includes('风格') || 
                 message.content.includes('style') || message.content.includes('artwork') ||
                 message.content.includes('DRAWING_FINAL'))) {
                
                console.log('🔍 Found general artwork description, creating fallback prompt');
                return `Generated artwork style ${imageIndex + 1} based on user preferences, high quality, detailed, masterpiece`;
            }
        }
        
        return '';
    }
    
    showSingleImageViewer(imageData) {
        // Create single image viewer modal
        const overlay = document.createElement('div');
        overlay.className = 'image-viewer-overlay';
        overlay.innerHTML = `
            <div class="image-viewer-modal single-image">
                <div class="image-viewer-header">
                    <button class="image-viewer-close">&times;</button>
                </div>
                <div class="image-viewer-content">
                    <div class="image-viewer-main">
                        <img src="${imageData.src}" alt="${imageData.alt}" class="image-viewer-large">
                    </div>
                </div>
            </div>
        `;
        
        // 添加到页面
        document.body.appendChild(overlay);
        
        // 绑定关闭事件
        const closeBtn = overlay.querySelector('.image-viewer-close');
        closeBtn.onclick = () => {
            document.body.removeChild(overlay);
        };
        
        // 点击背景关闭
        overlay.onclick = (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        };
        
        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                document.body.removeChild(overlay);
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        // 显示动画
        requestAnimationFrame(() => {
            overlay.classList.add('show');
        });
    }
    

    
    async handleRegenerateImages() {
        try {
            // 禁用重新生成按钮，防止重复点击
            const regenerateBtn = this.currentImageBubble.querySelector('.regenerate-btn');
            if (regenerateBtn) {
                regenerateBtn.disabled = true;
                regenerateBtn.textContent = '🔄 Generating...';
            }
            
            // 🎯 使用保存的完整meta prompt，而不是从聊天历史重新提取
            let metaPrompt = '';
            
            if (this.lastMetaPrompt) {
                // 使用已保存的meta prompt
                metaPrompt = this.lastMetaPrompt;
                console.log('🎯 Regenerating using saved meta prompt:', metaPrompt);
            } else {
                // If no saved meta prompt, search from chat history
                console.log('⚠️ No saved meta prompt found, trying to restore from chat history...');
                
                const currentChat = this.chats[this.currentChatId];
                if (currentChat && currentChat.messages.length > 0) {
                    // 从后往前找AI关于图片生成的完整回复
                    for (let i = currentChat.messages.length - 1; i >= 0; i--) {
                        const message = currentChat.messages[i];
                        if (message.role === 'assistant' && 
                            (message.content.includes('画风') || 
                             message.content.includes('多样化') ||
                             message.content.includes('ANIME STYLE') ||
                             message.content.includes('确定要求'))) {
                            
                            // Found complete meta prompt message
                            metaPrompt = message.content;
                            console.log('📝 Restored meta prompt from chat history:', metaPrompt);
                            break;
                        }
                    }
                }
                
                // If still not found, use fallback approach
                if (!metaPrompt) {
                    // Extract basic description from user messages
                    for (let i = currentChat.messages.length - 1; i >= 0; i--) {
                        const message = currentChat.messages[i];
                        if (message.role === 'user' && 
                            (message.content.includes('I confirm selection') || 
                             message.content.includes('start drawing'))) {
                            
                            const match = message.content.match(/draw(.+?)[\.\,]/);
                            if (match) {
                                metaPrompt = `Generate 4 different style images related to "${match[1].trim()}" for the user.`;
                                console.log('📝 Fallback approach generated meta prompt:', metaPrompt);
                                break;
                            }
                        }
                    }
                }
                
                // Final default value
                if (!metaPrompt) {
                    metaPrompt = 'Generate 4 high-quality artworks with diverse styles.';
                    console.log('📝 Using default meta prompt');
                }
            }
            
            // 创建新的图片生成气泡，绑定到当前对话
            const targetChatId = this.currentChatId;
            this.createImageGenerationBubble(targetChatId);
            
            // 🆕 标记正在准备重新生成任务
            this.preparingGeneration = true;
            this.generationChatId = targetChatId;
            
            // 使用完整的meta prompt调用图片生成API
            const response = await fetch('/api/generate_images', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: metaPrompt,
                    chat_id: this.currentChatId
                })
            });
            
            if (!response.ok) {
                throw new Error('Regeneration request failed');
            }
            
            const data = await response.json();
            this.currentTaskId = data.task_id;
            this.generationStartTime = Date.now();
            this.generationChatId = this.currentChatId;
            
            console.log('🎨 Regeneration task started, task ID:', this.currentTaskId);
            
            // 开始轮询图片生成状态
            this.pollImageGeneration();
            
        } catch (error) {
            console.error('Regenerate images error:', error);
            this.preparingGeneration = false; // 🆕 出错时清除准备状态
            this.showImageGenerationError('Regeneration failed, please try again later.');
            
            // Restore button state
            const regenerateBtn = this.currentImageBubble.querySelector('.regenerate-btn');
            if (regenerateBtn) {
                regenerateBtn.disabled = false;
                regenerateBtn.textContent = '🔄 Regenerate';
            }
        }
    }
    

    
    updateImageGrid(images) {
        if (!this.currentImageGrid) return;
        
        // 🚨 重要：只有当生成任务的对话与当前显示的对话一致时才更新UI
        if (this.generationChatId && this.generationChatId !== this.currentChatId) {
            console.log('🚫 Skipping UI update: generation chat ID does not match current chat ID', {
                generationChatId: this.generationChatId,
                currentChatId: this.currentChatId
            });
            return;
        }
        
        images.forEach((imageData, index) => {
            const placeholder = this.currentImageGrid.querySelector(`[data-index="${index}"]`);
            if (!placeholder) return;
            
            // Get the prompt corresponding to the image (truncate to 50 characters for display)
            const imagePrompt = imageData.prompt || '';
            const shortPrompt = imagePrompt.length > 50 ? imagePrompt.substring(0, 50) + '...' : imagePrompt;
            
            if (imageData.status === 'completed' && imageData.url) {
                // Image generation completed - ensure complete prompt is stored in title
                placeholder.innerHTML = `
                    <img src="${imageData.url}" alt="Generated Image ${index + 1}" class="generated-image" title="${imagePrompt}" data-full-prompt="${imagePrompt}">
                    <div class="image-prompt-info">${shortPrompt}</div>
                `;
                placeholder.classList.add('completed');
            } else if (imageData.status === 'failed') {
                // Image generation failed
                placeholder.innerHTML = `
                    <div class="error-indicator">❌</div>
                    <p>Generation Failed</p>
                    ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                `;
                placeholder.classList.add('failed');
                // 为失败的图片也保存prompt信息
                placeholder.setAttribute('data-full-prompt', imagePrompt);
            } else if (imageData.status === 'generating') {
                // Image generating
                placeholder.innerHTML = `
                    <div class="loading-spinner"></div>
                    <p>Generating...</p>
                    ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                `;
                placeholder.classList.add('generating');
                placeholder.setAttribute('data-full-prompt', imagePrompt);
            } else if (imageData.status === 'pending') {
                // Pending
                placeholder.innerHTML = `
                    <div class="waiting-indicator">⏳</div>
                    <p>Pending...</p>
                    ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                `;
                placeholder.classList.add('pending');
                placeholder.setAttribute('data-full-prompt', imagePrompt);
            }
        });
        
        // 更新整体状态提示
        const completedCount = images.filter(img => img.status === 'completed').length;
        const generatingCount = images.filter(img => img.status === 'generating').length;
        const failedCount = images.filter(img => img.status === 'failed').length;
        
        const statusText = this.currentImageBubble.querySelector('.message-text p');
        if (statusText) {
            let newStatusText = '';
            if (completedCount === 4) {
                newStatusText = '🎉 All four different style images have been generated!';
            } else if (failedCount > 0) {
                newStatusText = `Generating diverse images... (Completed: ${completedCount}/4, Failed: ${failedCount})`;
            } else if (generatingCount > 0) {
                newStatusText = `Generating diverse images... (Completed: ${completedCount}/4, Generating: ${generatingCount})`;
            } else {
                newStatusText = `Preparing diverse images... (Completed: ${completedCount}/4)`;
            }
            
            // 清理状态文本，确保没有额外的空白
            statusText.textContent = newStatusText.trim();
            
            // 更新聊天历史中的内容
            this.updateChatHistoryImageStatus(newStatusText, images);
        }
    }
    
    updateChatHistoryImageStatus(statusText, images) {
        // Update image generation status in chat history
        const chat = this.chats[this.currentChatId];
        if (chat && chat.messages.length > 0) {
            // Find the last AI message (should be image generation message) - support both Chinese and English
            for (let i = chat.messages.length - 1; i >= 0; i--) {
                if (chat.messages[i].role === 'assistant' && 
                    (chat.messages[i].content.includes('正在为您生成四张') ||
                     chat.messages[i].content.includes('图片生成结果：') ||
                     chat.messages[i].content.includes('图片生成完成') ||
                     chat.messages[i].content.includes('四张图片') ||
                     chat.messages[i].content.includes('Generating four beautiful images') ||
                     chat.messages[i].content.includes('Image generation result:') ||
                     chat.messages[i].content.includes('Image generation completed') ||
                     chat.messages[i].content.includes('All four different style images') ||
                     chat.messages[i].content.includes('Preparing to generate') ||
                     chat.messages[i].content.includes('task_id:'))) {
                    
                    console.log('🔄 Updating chat history, original content:', chat.messages[i].content);
                    
                    // Clean status text, remove possible extra newlines
                    const cleanStatusText = statusText.trim();
                    
                    // Build complete content containing image information - use English format
                    let imageContent = cleanStatusText + '\n\nImage generation result:\n';
                    
                    // If there's a task ID, add it to content
                    if (this.currentTaskId) {
                        imageContent += `task_id: ${this.currentTaskId}\n`;
                    }
                    
                    images.forEach((img, index) => {
                        if (img.status === 'completed' && img.url) {
                            // Include prompt information
                            const promptInfo = img.prompt ? ` (${img.prompt.substring(0, 100)}${img.prompt.length > 100 ? '...' : ''})` : '';
                            imageContent += `Image${index + 1}: ${img.url}${promptInfo}\n`;
                        } else {
                            // Even if status is not completed, save prompt information
                            const promptInfo = img.prompt ? ` (${img.prompt.substring(0, 100)}${img.prompt.length > 100 ? '...' : ''})` : '';
                            imageContent += `Image${index + 1}: ${img.status}${promptInfo}\n`;
                        }
                    });
                    
                    // Final cleanup: remove trailing newlines
                    imageContent = imageContent.trim();
                    
                    console.log('🔄 Updating chat history, new content:', JSON.stringify(imageContent));
                    
                    chat.messages[i].content = imageContent;
                    this.saveToStorage();
                    break;
                }
            }
        }
    }
    
    showImageGenerationError(message) {
        // 🚨 重要：只有当生成任务的对话与当前显示的对话一致时才更新UI
        if (this.generationChatId && this.generationChatId !== this.currentChatId) {
            console.log('🚫 Skipping error UI update: generation chat ID does not match current chat ID', {
                generationChatId: this.generationChatId,
                currentChatId: this.currentChatId
            });
            // 但是仍然需要清理任务状态
            this.currentTaskId = null;
            this.generationChatId = null;
            this.preparingGeneration = false; // 🆕 清理准备状态
            if (this.pollingTimerId) {
                clearTimeout(this.pollingTimerId);
                this.pollingTimerId = null;
            }
            if (this.backgroundPollingTimerId) {
                clearTimeout(this.backgroundPollingTimerId);
                this.backgroundPollingTimerId = null;
            }
            return;
        }
        
        if (this.currentImageBubble) {
            const messageText = this.currentImageBubble.querySelector('.message-text');
            messageText.innerHTML = `
                <p>❌ ${message}</p>
                <button class="retry-btn" onclick="canvasFlow.retryImageGeneration()">Retry</button>
            `;
        }
        
        // Clear task state
        this.currentTaskId = null;
        this.generationChatId = null;
        this.preparingGeneration = false; // 🆕 清理准备状态
        
        // Clear all timers
        if (this.pollingTimerId) {
            clearTimeout(this.pollingTimerId);
            this.pollingTimerId = null;
        }
        if (this.backgroundPollingTimerId) {
            clearTimeout(this.backgroundPollingTimerId);
            this.backgroundPollingTimerId = null;
        }
    }
    
    retryImageGeneration() {
        // Restart image generation process，绑定到当前对话
        const targetChatId = this.currentChatId;
        this.createImageGenerationBubble(targetChatId);
        
        // 🆕 标记正在准备重试任务
        this.preparingGeneration = true;
        this.generationChatId = targetChatId;
        
        // Re-retrieve prompt and start generation - look for messages containing DRAWING_FINAL
        const drawingFinalMessages = this.messagesContainer.querySelectorAll('.message.assistant');
        let prompt = '';
        
        // Search from back to front for messages containing DRAWING_FINAL
        for (let i = drawingFinalMessages.length - 1; i >= 0; i--) {
            const message = drawingFinalMessages[i];
            if (message.textContent.includes('English Prompt')) {
                // Look for code blocks containing English prompts
                const codeElements = message.querySelectorAll('code, pre code');
                for (let codeElement of codeElements) {
                    const codeText = codeElement.textContent.trim();
                    // Check if it's an English prompt
                    if (codeText.length > 20 && 
                        /[a-zA-Z]/.test(codeText) &&
                        (codeText.includes('quality') || codeText.includes('detailed') || 
                         codeText.includes('masterpiece') || codeText.includes('beautiful') ||
                         codeText.includes('art') || codeText.includes('style'))) {
                        prompt = codeText;
                        break;
                    }
                }
                if (prompt) break;
            }
        }
        
        if (!prompt) {
            prompt = 'A beautiful artwork, high quality, detailed, masterpiece';
        }
        
        console.log('Drawing prompt extracted during retry:', prompt);
        this.generationStartTime = Date.now(); // Reset start time
        this.generationChatId = null; // Reset chat ID, will be re-set in startImageGeneration
        this.startImageGeneration(prompt);
    }
    
    disableAllPreviousDrawingOptions() {
        // Find all drawing option buttons in current conversation
        const allOptionBtns = this.messagesContainer.querySelectorAll('.drawing-option-btn');
        
        allOptionBtns.forEach(btn => {
            // If not yet locked, disable it
            if (!btn.classList.contains('final-selected') && !btn.classList.contains('final-unselected')) {
                btn.classList.add('final-unselected');
                btn.onclick = null;
                btn.disabled = true;
            }
        });
        
        // Remove all previous action buttons
        const allActionsContainers = this.messagesContainer.querySelectorAll('.drawing-actions-container, .drawing-final-actions-container');
        allActionsContainers.forEach(container => {
            container.remove();
        });
    }
    
    disableAllButLastDrawingOptions() {
        // 找到所有的绘画选项容器
        const allOptionsContainers = this.messagesContainer.querySelectorAll('.drawing-options-container');
        
        // 如果有多个选项容器，除了最后一个，其他都禁用
        if (allOptionsContainers.length > 1) {
            // 禁用除了最后一个容器之外的所有容器
            for (let i = 0; i < allOptionsContainers.length - 1; i++) {
                const container = allOptionsContainers[i];
                const optionBtns = container.querySelectorAll('.drawing-option-btn');
                
                optionBtns.forEach(btn => {
                    if (!btn.classList.contains('final-selected') && !btn.classList.contains('final-unselected')) {
                        btn.classList.add('final-unselected');
                        btn.onclick = null;
                        btn.disabled = true;
                    }
                });
            }
        }
        
        // 移除除了最后一个之外的所有操作按钮
        const allActionsContainers = this.messagesContainer.querySelectorAll('.drawing-actions-container, .drawing-final-actions-container');
        if (allActionsContainers.length > 1) {
            for (let i = 0; i < allActionsContainers.length - 1; i++) {
                allActionsContainers[i].remove();
            }
        }
    }
    
    lockDrawingOptions(container, selectedOptions) {
        // 获取所有选项按钮
        const optionBtns = container.querySelectorAll('.drawing-option-btn');
        
        // 锁定选项状态
        optionBtns.forEach(btn => {
            const optionText = btn.textContent.trim();
            // 移除所有现有的选择状态
            btn.classList.remove('selected');
            
            // 设置最终状态
            if (selectedOptions.includes(optionText)) {
                btn.classList.add('final-selected');
            } else {
                btn.classList.add('final-unselected');
            }
            
            // 移除点击事件
            btn.onclick = null;
            btn.disabled = true;
        });
        
        // 找到操作按钮容器并完全移除
        const actionsContainer = container.parentElement.querySelector('.drawing-actions-container');
        if (actionsContainer) {
            actionsContainer.remove();
        }
    }
    
    simulateUserMessage(message) {
        // Simulate user sending message but don't display in interface
        setTimeout(() => {
            this.sendMessageInternal(message, false); // false means don't show user message
        }, 500);
    }
    
    async sendMessageInternal(message, showUserMessage = true) {
        if (!message || this.isStreaming) return;
        
        // 锁定当前对话ID
        const targetChatId = this.currentChatId;
        
        // Optionally show user message
        if (showUserMessage) {
            this.addMessageToChat(targetChatId, 'user', message);
        }
        
        // Show input status
        this.showTypingIndicator();
        this.setStatus('thinking', 'Thinking...');
        
        try {
            // 发送请求到后端
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    chat_id: targetChatId
                })
            });
            
            if (!response.ok) {
                throw new Error('Network request failed');
            }
            
            // 处理流式响应
            await this.handleStreamResponse(response, targetChatId);
            
        } catch (error) {
            console.error('Failed to send message:', error);
            this.hideTypingIndicator();
            this.addMessageToChat(targetChatId, 'assistant', 'Sorry, an error occurred while sending the message. Please try again later.');
            this.setStatus('error', 'Connection error');
            this.isStreaming = false;
            this.streamingChatId = null;
            this.streamingMessageElement = null;
            this.toggleSendButton();
            this.updateSidebar();
        }
    }
    
    showTypingIndicator() {
        this.isStreaming = true;
        this.toggleSendButton();
        
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message assistant';
        typingDiv.id = 'typing-indicator';
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = 'AI';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        const indicatorDiv = document.createElement('div');
        indicatorDiv.className = 'typing-indicator';
        
        const dotsDiv = document.createElement('div');
        dotsDiv.className = 'typing-dots';
        
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            dotsDiv.appendChild(dot);
        }
        
        indicatorDiv.appendChild(dotsDiv);
        contentDiv.appendChild(indicatorDiv);
        
        typingDiv.appendChild(avatar);
        typingDiv.appendChild(contentDiv);
        
        this.messagesContainer.appendChild(typingDiv);
        this.smartScrollToBottom();
    }
    
    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
    
    addToHistory(role, content) {
        this.addToHistoryForChat(this.currentChatId, role, content);
    }
    
    addToHistoryForChat(chatId, role, content) {
        const chat = this.chats[chatId];
        if (chat) {
        chat.messages.push({
            role: role,
            content: content,
            timestamp: Date.now()
        });
            // 更新最新消息时间
            chat.lastMessageTime = Date.now();
            // 自动保存到本地存储
            this.saveToStorage();
        }
    }
    
    updateChatPreview() {
        this.updateChatPreviewForChat(this.currentChatId);
    }
    
    updateChatPreviewForChat(chatId) {
        const chat = this.chats[chatId];
        if (!chat) return;
        
        const lastMessage = chat.messages[chat.messages.length - 1];
        
        if (lastMessage) {
            // 更新对话标题（如果是第一条用户消息）
            const firstUserMessage = chat.messages.find(msg => msg.role === 'user');
            if (firstUserMessage && chat.title === '新对话') {
                chat.title = firstUserMessage.content.substring(0, 30) + (firstUserMessage.content.length > 30 ? '...' : '');
            }
            
            // 更新聊天项目
            const chatItem = document.querySelector(`[data-chat-id="${chatId}"]`);
            if (chatItem) {
                chatItem.querySelector('.chat-title').textContent = chat.title;
                // 显示最后一条消息的预览
                const previewText = lastMessage.content.substring(0, 50) + (lastMessage.content.length > 50 ? '...' : '');
                chatItem.querySelector('.chat-preview').textContent = previewText;
            }
            
            // 保存更新后的数据
            this.saveToStorage();
        }
    }
    
    createNewChat() {
        const chatId = 'chat_' + Date.now();
        const newChat = {
            id: chatId,
            title: '新对话',
            messages: [],
            created: Date.now(),
            lastMessageTime: null
        };
        
        this.chats[chatId] = newChat;
        this.saveToStorage();
        this.switchToChat(chatId);
        this.updateSidebar();
    }
    
    deleteChat(chatId) {
        // 不能删除正在处理的对话（思考中或回复中）
        if (this.isStreaming && (this.streamingChatId === chatId || this.currentChatId === chatId)) {
            this.showModal('Info', 'Cannot delete a conversation that is being processed. Please wait for completion before trying again.', 'info');
            return;
        }
        
        // 确认删除
        this.showModal('Confirm Delete', 'Are you sure you want to delete this conversation? This action cannot be undone.', 'confirm', () => {
            this.performDelete(chatId);
        });
    }
    
    performDelete(chatId) {
        // 删除对话
        delete this.chats[chatId];
        
        // 如果删除的是当前对话，需要切换到其他对话
        if (this.currentChatId === chatId) {
            const remainingChats = Object.keys(this.chats);
            
            if (remainingChats.length > 0) {
                // 切换到第一个剩余对话
                this.currentChatId = remainingChats[0];
            } else {
                // 没有剩余对话，创建新对话
                const newChatId = 'chat_' + Date.now();
                this.chats[newChatId] = {
                    id: newChatId,
                    title: '新对话',
                    messages: [],
                    created: Date.now(),
                    lastMessageTime: null
                };
                this.currentChatId = newChatId;
            }
            
            // 重新加载聊天消息
            this.loadChatMessages();
        }
        
        // 更新侧边栏和保存
        this.updateSidebar();
        this.saveToStorage();
    }
    
    showModal(title, message, type = 'info', onConfirm = null) {
        // 移除现有的模态框
        this.hideModal();
        
        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                </div>
                <div class="modal-body">
                    <p>${message}</p>
                </div>
                <div class="modal-footer">
                    ${type === 'confirm' ? 
                        '<button class="modal-btn modal-btn-cancel">Cancel</button><button class="modal-btn modal-btn-confirm">Confirm</button>' : 
                        '<button class="modal-btn modal-btn-ok">OK</button>'}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 绑定事件
        if (type === 'confirm') {
            modal.querySelector('.modal-btn-cancel').addEventListener('click', () => {
                this.hideModal();
            });
            modal.querySelector('.modal-btn-confirm').addEventListener('click', () => {
                this.hideModal();
                if (onConfirm) onConfirm();
            });
        } else {
            modal.querySelector('.modal-btn-ok').addEventListener('click', () => {
                this.hideModal();
            });
        }
        
        // 点击遮罩关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideModal();
            }
        });
        
        // ESC键关闭
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.hideModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
        
        // 添加显示动画
        setTimeout(() => {
            modal.classList.add('show');
        }, 10);
    }
    
    hideModal() {
        const modal = document.querySelector('.modal-overlay');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.remove();
            }, 300);
        }
    }
    

    
    switchToChat(chatId) {
        // If streaming reply is in progress, give user a hint
        if (this.isStreaming && this.streamingChatId !== chatId) {
            console.log('Processing reply, response will be saved to original conversation after switching');
        }
        
        // If there's an image generation task not belonging to target conversation, clean UI state but keep background task
        if ((this.currentTaskId || this.preparingGeneration) && this.generationChatId && this.generationChatId !== chatId) {
            console.log('🔄 Switching conversation, image generation task moving to background mode', {
                currentTaskId: this.currentTaskId,
                preparingGeneration: this.preparingGeneration,
                generationChatId: this.generationChatId,
                switchingTo: chatId
            });
            // 清理当前UI引用，因为不再需要更新UI
            this.currentImageGrid = null;
            this.currentImageBubble = null;
            // Only clean foreground timer, background timer will be set automatically in pollImageGeneration
            if (this.pollingTimerId) {
                clearTimeout(this.pollingTimerId);
                this.pollingTimerId = null;
            }
        }
        
        // If switching to a conversation that has ongoing image generation or preparation, restore UI references
        if ((this.currentTaskId || this.preparingGeneration) && this.generationChatId === chatId) {
            console.log('🔄 Switching to conversation with ongoing image generation/preparation, will restore UI after loading messages', {
                currentTaskId: this.currentTaskId,
                preparingGeneration: this.preparingGeneration
            });
        }
        
        // Remove current active state
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Set new active state
        const newActiveItem = document.querySelector(`[data-chat-id="${chatId}"]`);
        if (newActiveItem) {
            newActiveItem.classList.add('active');
        }
        
        // Switch current chat
        this.currentChatId = chatId;
        
        // 🎯 Clear previous conversation's meta prompt to avoid misuse
        this.lastMetaPrompt = null;
        
        this.saveToStorage();
        this.loadChatMessages();
        
        // Disable all options in new conversation except the latest ones
        setTimeout(() => {
            this.disableAllButLastDrawingOptions();
        }, 100);
        
        // If switching to conversation with streaming reply, restore streaming status display
        if (this.isStreaming && this.streamingChatId === chatId) {
            this.setStatus('streaming', 'Replying...');
            // Ensure any possible typing indicator is cleaned up
            this.hideTypingIndicator();
        }
    }
    
    loadChatMessages() {
        const chat = this.chats[this.currentChatId];
        this.messagesContainer.innerHTML = '';
        
        // 🧹 清理跨对话的UI引用
        this.cleanupCrossConversationReferences();
        
        // Reset scroll state since user actively switched conversations
        this.userScrolledUp = false;
        this.hideNewMessageIndicator();
        
        if (chat && chat.messages.length === 0) {
            this.loadWelcomeMessage();
        } else if (chat && chat.messages.length > 0) {
            // Load all historical messages
            chat.messages.forEach(msg => {
                const messageElement = this.createMessageElement(msg.role, msg.content);
                // 🎯 为所有消息元素添加对话ID标记
                messageElement.setAttribute('data-chat-id', this.currentChatId);
                this.messagesContainer.appendChild(messageElement);
            });
            this.scrollToBottom();
            
            // Check if there are ongoing image generation tasks that need to be restored
            this.checkAndRestoreImageGeneration();
        }
        
        // If current conversation is streaming reply, clear streamingMessageElement reference
        // Since DOM has been cleared, need to recreate
        if (this.isStreaming && this.streamingChatId === this.currentChatId) {
            this.streamingMessageElement = null;
        }
    }
    
    cleanupCrossConversationReferences() {
        // 清理可能的跨对话UI引用
        if (this.currentImageGrid) {
            const gridChatId = this.currentImageGrid.closest('.message')?.getAttribute('data-chat-id');
            if (gridChatId && gridChatId !== this.currentChatId) {
                console.log('🧹 Cleaning up cross-conversation image grid reference', {
                    gridChatId,
                    currentChatId: this.currentChatId
                });
                this.currentImageGrid = null;
            }
        }
        
        if (this.currentImageBubble) {
            const bubbleChatId = this.currentImageBubble.getAttribute('data-chat-id');
            if (bubbleChatId && bubbleChatId !== this.currentChatId) {
                console.log('🧹 Cleaning up cross-conversation image bubble reference', {
                    bubbleChatId,
                    currentChatId: this.currentChatId
                });
                this.currentImageBubble = null;
            }
        }
    }
    
    loadWelcomeMessage() {
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'welcome-message';
        welcomeDiv.innerHTML = `
            <div class="welcome-content">
                <h3>Welcome to CanvasFlow!</h3>
                <p>I'm your AI drawing assistant. I can help you create images, analyze prompts, and answer various questions.</p>
                <div class="example-prompts">
                    <button class="example-btn">I want to draw a cute kitten</button>
                    <button class="example-btn">Help me draw a futuristic city landscape</button>
                    <button class="example-btn">Create a magical forest scene</button>
                    <button class="example-btn">Explain the basic concepts of machine learning</button>
                </div>
            </div>
        `;
        this.messagesContainer.appendChild(welcomeDiv);
    }
    
    hideWelcomeMessage() {
        const welcomeMessage = document.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
    }
    
    checkAndRestoreImageGeneration() {
        // Find the last image generation bubble
        const imageGrids = this.messagesContainer.querySelectorAll('.image-grid');
        if (imageGrids.length === 0) return;
        
        // Get the last image grid (newest image generation task)
        const lastImageGrid = imageGrids[imageGrids.length - 1];
        
        console.log('🔍 Checking image generation status restoration, current chat:', this.currentChatId);
        console.log('🔍 Current task status:', {
            taskId: this.currentTaskId,
            preparingGeneration: this.preparingGeneration,
            generationChatId: this.generationChatId,
            isMyTask: this.generationChatId === this.currentChatId
        });
        
        // 🆕 首先检查聊天历史中是否有活跃的任务信息
        const activeTaskInfo = this.extractActiveTaskFromHistory();
        if (activeTaskInfo) {
            console.log('🔍 Found active task in chat history:', activeTaskInfo);
            
            // 如果发现活跃任务，但当前没有任务状态，恢复任务状态
            if (!this.currentTaskId && !this.preparingGeneration) {
                console.log('✅ Restoring task state from chat history');
                this.currentTaskId = activeTaskInfo.taskId;
                this.generationChatId = this.currentChatId;
                this.generationStartTime = Date.now() - 30000; // 假设任务已经运行30秒
                
                // 恢复UI引用
                lastImageGrid.classList.remove('historical');
                lastImageGrid.classList.add('active');
                this.currentImageGrid = lastImageGrid;
                this.currentImageBubble = lastImageGrid.closest('.message');
                
                // 确保气泡标记了正确的对话ID
                if (this.currentImageBubble && !this.currentImageBubble.getAttribute('data-chat-id')) {
                    this.currentImageBubble.setAttribute('data-chat-id', this.currentChatId);
                }
                
                // 查询当前任务状态并更新UI
                this.checkCurrentTaskStatusAndUpdate();
                return;
            }
        }
        
        // Check if any images are still generating or pending
        const placeholders = lastImageGrid.querySelectorAll('.image-placeholder');
        let hasIncomplete = false;
        let hasCompleted = false;
        
        for (let placeholder of placeholders) {
            if (placeholder.classList.contains('generating') || 
                placeholder.classList.contains('pending') ||
                (placeholder.textContent.includes('生成中') || 
                 placeholder.textContent.includes('等待中') ||
                 placeholder.textContent.includes('Generating') ||
                 placeholder.textContent.includes('Pending'))) {
                hasIncomplete = true;
            }
            if (placeholder.classList.contains('completed')) {
                hasCompleted = true;
            }
        }
        
        // If all images are completed, check if action buttons need to be added
        if (!hasIncomplete && hasCompleted) {
            const messageBubble = lastImageGrid.closest('.message');
            if (messageBubble && !messageBubble.querySelector('.image-action-buttons')) {
                console.log('🔧 Adding missing action buttons');
                this.currentImageBubble = messageBubble;
                this.currentImageGrid = lastImageGrid;
                this.addImageActionButtons();
            }
            return; // Task completed, no further processing needed
        }
        
        // 🆕 Check if there are completed images that need to be re-rendered from chat history
        if (!hasCompleted && !hasIncomplete) {
            console.log('🔍 No visible images found, checking chat history for completed images');
            this.checkAndRestoreCompletedImagesFromHistory(lastImageGrid);
            return;
        }
        
        if (hasIncomplete) {
            console.log('🔄 Found incomplete image generation tasks');
            
            // Case 1: If this is an ongoing task belonging to current chat
            if (this.currentTaskId && this.generationChatId === this.currentChatId) {
                console.log('✅ Restoring active image generation task for current chat', {
                    taskId: this.currentTaskId,
                    generationChatId: this.generationChatId,
                    currentChatId: this.currentChatId
                });
                
                // 🆕 强制恢复UI引用，即使之前没有正确设置
                lastImageGrid.classList.remove('historical');
                lastImageGrid.classList.add('active');
                this.currentImageGrid = lastImageGrid;
                this.currentImageBubble = lastImageGrid.closest('.message');
                
                // 确保气泡标记了正确的对话ID
                if (this.currentImageBubble && !this.currentImageBubble.getAttribute('data-chat-id')) {
                    this.currentImageBubble.setAttribute('data-chat-id', this.currentChatId);
                }
                
                // 🆕 如果有后台轮询在进行，切换到前台轮询
                if (this.backgroundPollingTimerId) {
                    console.log('🔄 切换从后台轮询到前台轮询');
                    clearTimeout(this.backgroundPollingTimerId);
                    this.backgroundPollingTimerId = null;
                }
                
                // 🆕 查询当前任务状态并更新UI
                this.checkCurrentTaskStatusAndUpdate();
                return;
            }
            
            // 🆕 Case 1.5: If this is a preparing generation task belonging to current chat
            if (this.preparingGeneration && this.generationChatId === this.currentChatId) {
                console.log('✅ Restoring preparing image generation task for current chat', {
                    preparingGeneration: this.preparingGeneration,
                    generationChatId: this.generationChatId,
                    currentChatId: this.currentChatId
                });
                lastImageGrid.classList.remove('historical');
                lastImageGrid.classList.add('active');
                this.currentImageGrid = lastImageGrid;
                this.currentImageBubble = lastImageGrid.closest('.message');
                
                // 确保气泡标记了正确的对话ID
                if (this.currentImageBubble && !this.currentImageBubble.getAttribute('data-chat-id')) {
                    this.currentImageBubble.setAttribute('data-chat-id', this.currentChatId);
                }
                
                console.log('⏳ Waiting for image generation task to start...');
                return;
            }
            
            // Case 2: Another chat has an ongoing task, don't interfere
            if ((this.currentTaskId || this.preparingGeneration) && this.generationChatId && this.generationChatId !== this.currentChatId) {
                console.log('🚫 Another chat has ongoing image generation or preparation, showing prompt');
                this.showRestorePrompt('Another conversation is generating images, please wait for completion and retry', lastImageGrid);
                return;
            }
            
            // Case 3: No active task, try to query status from chat history
            console.log('🔍 No active task, checking chat history status');
            this.attemptRestoreFromHistory(lastImageGrid);
        }
    }
    
    attemptRestoreFromHistory(imageGrid) {
        // Try to get task information from chat history
        const chat = this.chats[this.currentChatId];
        if (chat && chat.messages.length > 0) {
            // Look for recent image generation messages - support both Chinese and English
            for (let i = chat.messages.length - 1; i >= 0; i--) {
                const message = chat.messages[i];
                if (message.role === 'assistant' && 
                    (message.content.includes('图片生成结果') || 
                     message.content.includes('正在为您生成四张精美的图片') ||
                     message.content.includes('Image generation result') ||
                     message.content.includes('Generating four beautiful images') ||
                     message.content.includes('All four different style images') ||
                     message.content.includes('task_id:'))) {
                    
                    // Check if this message has incomplete images
                    const lines = message.content.split('\n');
                    let hasIncompleteInHistory = false;
                    let potentialTaskId = null;
                    
                    for (let line of lines) {
                        if (line.includes('generating') || line.includes('pending')) {
                            hasIncompleteInHistory = true;
                        }
                        // Try to extract task ID if any
                        const taskMatch = line.match(/task_id:\s*([a-zA-Z0-9_-]+)/);
                        if (taskMatch) {
                            potentialTaskId = taskMatch[1];
                        }
                    }
                    
                    if (hasIncompleteInHistory) {
                        console.log('🔍 Found incomplete image generation from history, task ID:', potentialTaskId);
                        
                        if (potentialTaskId) {
                            // Has task ID, try to query status
                            this.checkTaskStatusAndRestore(potentialTaskId, imageGrid);
                        } else {
                            // No task ID, show retry button
                            this.showRestorePrompt('Cannot find task ID, please regenerate images', imageGrid);
                        }
                        return;
                    }
                }
            }
        }
        
        // If we get here, no relevant history was found
        console.log('🔍 No relevant image generation history found');
        this.showRestorePrompt('Cannot restore image generation status, please regenerate', imageGrid);
    }
    
    checkTaskStatusAndRestore(taskId, imageGrid) {
        // Check specific task status
        fetch(`/api/generate_images/status/${taskId}`)
            .then(response => response.json())
            .then(data => {
                console.log('🔍 Task status query result:', data);
                
                if (data.status === 'generating' || data.status === 'pending') {
                    console.log('✅ Task still in progress, restoring polling');
                    this.currentTaskId = taskId;
                    this.generationChatId = this.currentChatId;
                    
                    // Clean up old timers
                    if (this.pollingTimerId) {
                        clearTimeout(this.pollingTimerId);
                        this.pollingTimerId = null;
                    }
                    if (this.backgroundPollingTimerId) {
                        clearTimeout(this.backgroundPollingTimerId);
                        this.backgroundPollingTimerId = null;
                    }
                    
                    imageGrid.classList.remove('historical');
                    imageGrid.classList.add('active');
                    this.currentImageGrid = imageGrid;
                    this.currentImageBubble = imageGrid.closest('.message');
                    
                    // Update current status first, then start polling
                    if (data.images) {
                        this.updateImageGrid(data.images);
                    }
                    
                    this.pollImageGeneration();
                } else if (data.status === 'completed') {
                    console.log('🎉 Task completed, updating display');
                    this.updateImageGridWithResults(data, imageGrid);
                } else {
                    console.log('❌ Task status abnormal:', data.status);
                    this.showRestorePrompt('Task status abnormal, please regenerate images', imageGrid);
                }
            })
            .catch(error => {
                console.error('❌ Error querying task status:', error);
                this.showRestorePrompt('Failed to query task status, please regenerate images', imageGrid);
            });
    }
    
    updateImageGridWithResults(data, imageGrid) {
        // Update image grid with results
        const placeholders = imageGrid.querySelectorAll('.image-placeholder');
        
        if (data.images && Array.isArray(data.images)) {
            data.images.forEach((imageInfo, index) => {
                if (index < placeholders.length) {
                    const placeholder = placeholders[index];
                    const imagePrompt = imageInfo.prompt || '';
                    const shortPrompt = imagePrompt.length > 50 ? imagePrompt.substring(0, 50) + '...' : imagePrompt;
                    
                    if (imageInfo.status === 'completed' && imageInfo.url) {
                        // Image generation completed - display full information including prompt
                        placeholder.innerHTML = `
                            <img src="${imageInfo.url}" alt="Generated Image ${index + 1}" class="generated-image" title="${imagePrompt}" data-full-prompt="${imagePrompt}">
                            <div class="image-prompt-info">${shortPrompt}</div>
                        `;
                        placeholder.classList.remove('generating', 'pending', 'failed');
                        placeholder.classList.add('completed');
                        placeholder.setAttribute('data-full-prompt', imagePrompt);
                    } else if (imageInfo.status === 'failed') {
                        placeholder.innerHTML = `
                            <div class="error-indicator">❌</div>
                            <p>Generation Failed</p>
                            ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                        `;
                        placeholder.classList.remove('generating', 'pending', 'completed');
                        placeholder.classList.add('failed');
                        placeholder.setAttribute('data-full-prompt', imagePrompt);
                    }
                }
            });
        }
        
        // Update status text
        const messageText = imageGrid.closest('.message').querySelector('.message-text');
        const statusP = messageText ? messageText.querySelector('p') : null;
        
        const completedCount = data.images.filter(img => img.status === 'completed').length;
        const failedCount = data.images.filter(img => img.status === 'failed').length;
        
        let finalStatusText = '';
        if (completedCount === 4) {
            finalStatusText = '🎉 All four different style images have been generated successfully!';
        } else if (completedCount > 0) {
            finalStatusText = `✅ Image generation completed! Successfully generated ${completedCount} images${failedCount > 0 ? `, ${failedCount} failed` : ''}.`;
        } else {
            finalStatusText = '❌ All image generation failed';
        }
        
        if (statusP) {
            statusP.textContent = finalStatusText;
        }
        
        // If there are successfully generated images, add action buttons
        if (completedCount > 0) {
            // Set current image bubble reference so addImageActionButtons can work correctly
            this.currentImageBubble = imageGrid.closest('.message');
            this.currentImageGrid = imageGrid;
            
            // Check if buttons already exist to avoid duplicates
            if (!this.currentImageBubble.querySelector('.image-action-buttons')) {
                this.addImageActionButtons();
            } else {
                // If buttons already exist, ensure direct selection functionality is enabled
                this.enableDirectImageSelection();
            }
        }
        
        // Update chat history
        this.updateCompletedChatHistoryWithResults(data);
    }
    
    showRestorePrompt(message, imageGrid = null) {
        const targetImageGrid = imageGrid || this.currentImageGrid;
        if (!targetImageGrid) return;
        
        const statusDiv = targetImageGrid.parentNode.querySelector('.status-text');
        if (statusDiv) {
            statusDiv.textContent = message;
            
            // Add retry button
            const messageText = targetImageGrid.closest('.message').querySelector('.message-text');
            if (messageText && !messageText.querySelector('.retry-btn')) {
                const retryBtn = document.createElement('button');
                retryBtn.className = 'retry-btn';
                retryBtn.textContent = 'Regenerate';
                retryBtn.onclick = () => canvasFlow.retryImageGeneration();
                messageText.appendChild(retryBtn);
            }
        }
    }
    
    updateCompletedChatHistoryWithResults(data) {
        // Update image status in current chat history
        const chat = this.chats[this.currentChatId];
        if (chat && chat.messages.length > 0) {
            // Find the last image generation message - support both Chinese and English
            for (let i = chat.messages.length - 1; i >= 0; i--) {
                if (chat.messages[i].role === 'assistant' && 
                    (chat.messages[i].content.includes('正在为您生成四张') ||
                     chat.messages[i].content.includes('图片生成结果：') ||
                     chat.messages[i].content.includes('图片生成完成') ||
                     chat.messages[i].content.includes('四张图片') ||
                     chat.messages[i].content.includes('Generating four beautiful images') ||
                     chat.messages[i].content.includes('Image generation result:') ||
                     chat.messages[i].content.includes('Image generation completed') ||
                     chat.messages[i].content.includes('All four different style images') ||
                     chat.messages[i].content.includes('Preparing to generate') ||
                     chat.messages[i].content.includes('task_id:'))) {
                    
                    const completedCount = data.images.filter(img => img.status === 'completed').length;
                    const failedCount = data.images.filter(img => img.status === 'failed').length;
                    
                    let finalStatusText = '';
                    if (completedCount === 4) {
                        finalStatusText = '🎉 All four different style images have been generated successfully!';
                    } else if (completedCount > 0) {
                        finalStatusText = `✅ Image generation completed! Successfully generated ${completedCount} images${failedCount > 0 ? `, ${failedCount} failed` : ''}.`;
                    } else {
                        finalStatusText = '❌ All image generation failed';
                    }
                    
                    // Build complete content containing image information - use English format
                    let imageContent = finalStatusText.trim() + '\n\nImage generation result:\n';
                    
                    // If there's a task ID, add it to content
                    if (data.task_id || this.currentTaskId) {
                        imageContent += `task_id: ${data.task_id || this.currentTaskId}\n`;
                    }
                    
                    data.images.forEach((img, index) => {
                        if (img.status === 'completed' && img.url) {
                            // Include prompt information
                            const promptInfo = img.prompt ? ` (${img.prompt.substring(0, 100)}${img.prompt.length > 100 ? '...' : ''})` : '';
                            imageContent += `Image${index + 1}: ${img.url}${promptInfo}\n`;
                        } else {
                            // Even if status is not completed, save prompt information
                            const promptInfo = img.prompt ? ` (${img.prompt.substring(0, 100)}${img.prompt.length > 100 ? '...' : ''})` : '';
                            imageContent += `Image${index + 1}: ${img.status}${promptInfo}\n`;
                        }
                    });
                    
                    // Clean up trailing blank lines
                    imageContent = imageContent.trim();
                    
                    chat.messages[i].content = imageContent;
                    this.saveToStorage();
                    console.log('📝 Task completion history updated with prompt information');
                    break;
                }
            }
        }
    }
    
    setStatus(type, text) {
        this.statusText.textContent = text;
        this.statusIndicator.className = 'status-indicator';
        
        switch (type) {
            case 'ready':
                this.statusIndicator.style.backgroundColor = '#238636';
                break;
            case 'thinking':
            case 'streaming':
                this.statusIndicator.style.backgroundColor = '#D29922';
                break;
            case 'error':
                this.statusIndicator.style.backgroundColor = '#F85149';
                break;
        }
    }
    
    checkAndProcessBackgroundImageGeneration(targetChatId, fullResponse) {
        // 检查是否是针对准备中的图片生成任务的响应
        if (this.preparingGeneration && this.generationChatId === targetChatId && 
            fullResponse.includes('DRAWING_FINAL:')) {
            
            console.log('🔍 检测到后台图片生成任务的DRAWING_FINAL响应', {
                targetChatId: targetChatId,
                generationChatId: this.generationChatId,
                preparingGeneration: this.preparingGeneration,
                currentChatId: this.currentChatId
            });
            
            // 提取prompt内容
            const parts = fullResponse.split('DRAWING_FINAL:');
            let fullAIResponse = '';
            
            if (parts.length > 0) {
                // 使用DRAWING_FINAL之前的内容作为完整prompt
                fullAIResponse = parts[0].trim();
                console.log('🎨 提取到的完整AI回复用于后台图片生成:', fullAIResponse);
            }
            
            // 如果没有合适的prompt，使用默认内容
            if (!fullAIResponse) {
                fullAIResponse = 'User wants to generate a beautiful artwork, high quality, detailed, masterpiece level.';
                console.log('🎨 使用默认内容进行后台图片生成');
            }
            
            // 保存meta prompt用于重新生成
            this.lastMetaPrompt = fullAIResponse;
            
            // 启动图片生成 - 即使用户不在当前对话中也要执行
            this.startBackgroundImageGeneration(fullAIResponse, targetChatId);
        }
    }
    
    async startBackgroundImageGeneration(prompt, targetChatId) {
        try {
            console.log('🎨 开始后台图片生成任务', {
                prompt: prompt,
                targetChatId: targetChatId,
                currentChatId: this.currentChatId
            });
            
            // 发送图片生成请求
            const response = await fetch('/api/generate_images', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    prompt: prompt,
                    chat_id: targetChatId
                })
            });
            
            if (!response.ok) {
                throw new Error('后台图片生成请求失败');
            }
            
            const data = await response.json();
            
            // 更新任务状态
            this.currentTaskId = data.task_id;
            this.generationStartTime = Date.now();
            this.generationChatId = targetChatId;
            this.preparingGeneration = false; // 准备阶段结束
            
            console.log('🎨 后台图片生成任务启动成功', {
                taskId: this.currentTaskId,
                generationChatId: this.generationChatId,
                currentChatId: this.currentChatId
            });
            
            // 根据当前对话决定轮询方式
            if (this.currentChatId === targetChatId) {
                // 如果用户正在目标对话中，找到对应的image grid并开始前台轮询
                const restored = this.restoreImageGridForActiveTask();
                if (restored) {
                    this.pollImageGeneration();
                } else {
                    console.log('⚠️ 未能恢复UI引用，启动后台轮询');
                    this.pollImageGenerationBackground();
                }
            } else {
                // 如果用户不在目标对话中，启动后台轮询
                this.pollImageGenerationBackground();
            }
            
        } catch (error) {
            console.error('后台图片生成错误:', error);
            this.preparingGeneration = false;
            // 如果用户在目标对话中，显示错误
            if (this.currentChatId === targetChatId) {
                this.showImageGenerationError('Failed to start background image generation, please try again later.');
            }
        }
    }
    
    extractActiveTaskFromHistory() {
        // 从聊天历史记录中提取活跃的任务信息
        const chat = this.chats[this.currentChatId];
        if (!chat || !chat.messages.length) {
            return null;
        }
        
        // 查找最新的图片生成消息
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const message = chat.messages[i];
            if (message.role === 'assistant' && 
                (message.content.includes('Image generation result:') ||
                 message.content.includes('Generating four beautiful images') ||
                 message.content.includes('task_id:'))) {
                
                const lines = message.content.split('\n');
                let taskId = null;
                let hasIncomplete = false;
                
                // 查找task_id和未完成的图片
                for (let line of lines) {
                    // 提取task_id
                    const taskMatch = line.match(/task_id:\s*([a-zA-Z0-9_-]+)/);
                    if (taskMatch) {
                        taskId = taskMatch[1];
                    }
                    
                    // 检查是否有未完成的图片
                    if (line.includes('generating') || line.includes('pending') ||
                        (line.startsWith('Image') && (line.includes('generating') || line.includes('pending')))) {
                        hasIncomplete = true;
                    }
                }
                
                // 如果找到task_id且有未完成的图片，返回任务信息
                if (taskId && hasIncomplete) {
                    return {
                        taskId: taskId,
                        hasIncomplete: true
                    };
                }
            }
        }
        
        return null;
    }
    
    checkAndRestoreCompletedImagesFromHistory(imageGrid) {
        // 从聊天历史记录中查找已完成的图片信息
        const chat = this.chats[this.currentChatId];
        if (!chat || !chat.messages.length) {
            console.log('🔍 No chat history found');
            return;
        }
        
        // 查找最新的图片生成消息
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const message = chat.messages[i];
            if (message.role === 'assistant' && 
                (message.content.includes('Image generation result:') ||
                 message.content.includes('All four different style images') ||
                 message.content.includes('🎉 All four different style images have been generated successfully') ||
                 message.content.includes('✅ Image generation completed'))) {
                
                console.log('🔍 Found completed image generation message in history');
                
                // 解析图片信息
                const imageData = this.parseImageDataFromHistory(message.content);
                
                if (imageData.length > 0) {
                    console.log('🔧 Restoring completed images from history', imageData);
                    
                    // 重新渲染图片到UI
                    this.renderCompletedImagesFromHistory(imageGrid, imageData, message.content);
                    return;
                }
            }
        }
        
        console.log('🔍 No completed image generation found in history');
    }
    
    parseImageDataFromHistory(messageContent) {
        const lines = messageContent.split('\n');
        const imageData = [];
        
        for (let line of lines) {
            // 匹配 Image1: /path/to/image.jpg (prompt) 格式
            const match = line.match(/^Image(\d+):\s*([^(]+)(?:\s*\(([^)]+)\))?/);
            if (match) {
                const index = parseInt(match[1]) - 1;
                const urlOrStatus = match[2].trim();
                const prompt = match[3] || '';
                
                if (urlOrStatus.startsWith('/static/generated_images/')) {
                    imageData[index] = {
                        status: 'completed',
                        url: urlOrStatus,
                        prompt: prompt
                    };
                } else {
                    imageData[index] = {
                        status: urlOrStatus,
                        url: null,
                        prompt: prompt
                    };
                }
            }
        }
        
        return imageData;
    }
    
    renderCompletedImagesFromHistory(imageGrid, imageData, messageContent) {
        // 更新状态文本
        const messageBubble = imageGrid.closest('.message');
        if (messageBubble) {
            const statusText = messageBubble.querySelector('.message-text p');
            if (statusText) {
                // 从消息内容中提取状态文本
                const lines = messageContent.split('\n');
                const statusLine = lines[0] || 'Image generation completed';
                statusText.textContent = statusLine;
            }
        }
        
        // 渲染图片
        const placeholders = imageGrid.querySelectorAll('.image-placeholder');
        let completedCount = 0;
        
        for (let i = 0; i < Math.min(4, imageData.length); i++) {
            if (i < placeholders.length) {
                const placeholder = placeholders[i];
                const imgData = imageData[i];
                
                if (imgData && imgData.status === 'completed' && imgData.url) {
                    const shortPrompt = imgData.prompt && imgData.prompt.length > 50 ? 
                        imgData.prompt.substring(0, 50) + '...' : (imgData.prompt || '');
                    
                    placeholder.innerHTML = `
                        <img src="${imgData.url}" alt="Generated Image ${i + 1}" class="generated-image" title="${imgData.prompt || ''}" data-full-prompt="${imgData.prompt || ''}">
                        ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                    `;
                    placeholder.classList.remove('generating', 'pending', 'failed');
                    placeholder.classList.add('completed');
                    placeholder.setAttribute('data-full-prompt', imgData.prompt || '');
                    
                    completedCount++;
                } else if (imgData && imgData.status === 'failed') {
                    const shortPrompt = imgData.prompt && imgData.prompt.length > 50 ? 
                        imgData.prompt.substring(0, 50) + '...' : (imgData.prompt || '');
                    
                    placeholder.innerHTML = `
                        <div class="error-indicator">❌</div>
                        <p>Generation Failed</p>
                        ${shortPrompt ? `<div class="image-prompt-info">${shortPrompt}</div>` : ''}
                    `;
                    placeholder.classList.remove('generating', 'pending', 'completed');
                    placeholder.classList.add('failed');
                    placeholder.setAttribute('data-full-prompt', imgData.prompt || '');
                }
            }
        }
        
        // 如果有已完成的图片，添加操作按钮
        if (completedCount > 0 && messageBubble && !messageBubble.querySelector('.image-action-buttons')) {
            console.log('🔧 Adding action buttons to restored images');
            this.currentImageBubble = messageBubble;
            this.currentImageGrid = imageGrid;
            this.addImageActionButtons();
        }
    }
    
    async checkCurrentTaskStatusAndUpdate() {
        // 查询当前任务的最新状态并同步UI
        if (!this.currentTaskId) {
            console.log('⚠️ 没有当前任务ID，启动普通轮询');
            this.pollImageGeneration();
            return;
        }
        
        try {
            console.log('🔍 查询当前任务状态以同步UI', this.currentTaskId);
            const response = await fetch(`/api/generate_images/${this.currentTaskId}`);
            
            if (!response.ok) {
                throw new Error('获取任务状态失败');
            }
            
            const data = await response.json();
            console.log('🔍 当前任务状态:', data);
            
            // 立即更新UI以反映当前状态
            if (data.images && this.currentImageGrid) {
                this.updateImageGrid(data.images);
            }
            
            // 🆕 同时强制更新聊天历史记录，确保状态同步
            if (data.images) {
                const completedCount = data.images.filter(img => img.status === 'completed').length;
                const failedCount = data.images.filter(img => img.status === 'failed').length;
                this.updateBackgroundTaskHistory(data.images, completedCount, failedCount);
            }
            
            // 检查任务是否还在进行
            const hasGenerating = data.images.some(img => img.status === 'generating');
            const hasPending = data.images.some(img => img.status === 'pending');
            const completedCount = data.images.filter(img => img.status === 'completed').length;
            const failedCount = data.images.filter(img => img.status === 'failed').length;
            
            if (hasGenerating || hasPending) {
                // 任务还在进行，继续轮询
                console.log('⏳ 任务仍在进行，继续轮询');
                this.pollImageGeneration();
            } else if (completedCount + failedCount === 4) {
                // 任务已完成
                console.log('✅ 任务已完成，停止轮询');
                this.finishImageGeneration(completedCount, failedCount);
            } else {
                // 状态异常，启动普通轮询
                console.log('⚠️ 任务状态异常，启动普通轮询');
                this.pollImageGeneration();
            }
            
        } catch (error) {
            console.error('查询任务状态失败:', error);
            // 出错时启动普通轮询
            this.pollImageGeneration();
        }
    }
    
    restoreImageGridForActiveTask() {
        // 查找当前对话中最新的image grid
        const imageGrids = this.messagesContainer.querySelectorAll('.image-grid');
        if (imageGrids.length > 0) {
            const lastImageGrid = imageGrids[imageGrids.length - 1];
            
            // 检查是否是活跃状态或者显示为"Generating..."或"Incomplete"
            const placeholders = lastImageGrid.querySelectorAll('.image-placeholder');
            let hasIncomplete = false;
            
            for (let placeholder of placeholders) {
                if (placeholder.textContent.includes('Generating...') || 
                    placeholder.textContent.includes('Pending') ||
                    placeholder.textContent.includes('Pending...') ||
                    placeholder.classList.contains('generating') ||
                    placeholder.classList.contains('pending')) {
                    hasIncomplete = true;
                    break;
                }
            }
            
            if (hasIncomplete) {
                console.log('🔧 恢复活跃图片生成任务的UI引用');
                lastImageGrid.classList.remove('historical');
                lastImageGrid.classList.add('active');
                this.currentImageGrid = lastImageGrid;
                this.currentImageBubble = lastImageGrid.closest('.message');
                
                // 确保气泡标记了正确的对话ID
                if (this.currentImageBubble && !this.currentImageBubble.getAttribute('data-chat-id')) {
                    this.currentImageBubble.setAttribute('data-chat-id', this.currentChatId);
                }
                
                return true; // 成功恢复
            }
        }
        return false; // 未找到可恢复的网格
    }
    
    async forceSyncImageGenerationState(imageGrid, messageBubble) {
        // 🔧 强制同步图片生成状态
        console.log('🔧 开始强制同步图片生成状态');
        
        // 从消息内容中提取task_id
        const messageText = messageBubble.querySelector('.message-text').textContent;
        const taskIdMatch = messageText.match(/task_id:\s*([a-zA-Z0-9_-]+)/);
        
        if (!taskIdMatch) {
            console.log('🔧 未找到task_id，无法同步状态');
            return;
        }
        
        const taskId = taskIdMatch[1];
        console.log('🔧 找到task_id:', taskId);
        
        try {
            const response = await fetch(`/api/generate_images/${taskId}`);
            if (!response.ok) {
                throw new Error('查询任务状态失败');
            }
            
            const data = await response.json();
            console.log('🔧 获取到最新任务状态:', data);
            
            // 如果当前没有活跃任务，设置为当前任务
            if (!this.currentTaskId) {
                this.currentTaskId = taskId;
                this.generationChatId = this.currentChatId;
                this.generationStartTime = Date.now() - 60000; // 假设任务已经运行1分钟
            }
            
            // 更新UI引用
            this.currentImageGrid = imageGrid;
            this.currentImageBubble = messageBubble;
            
            // 强制更新UI状态
            this.updateImageGrid(data.images);
            
            // 检查是否需要继续轮询
            const hasGenerating = data.images.some(img => img.status === 'generating');
            const hasPending = data.images.some(img => img.status === 'pending');
            const completedCount = data.images.filter(img => img.status === 'completed').length;
            const failedCount = data.images.filter(img => img.status === 'failed').length;
            
            if (hasGenerating || hasPending) {
                console.log('🔧 检测到生成中的任务，启动轮询');
                this.pollImageGeneration();
            } else if (completedCount + failedCount === 4) {
                console.log('🔧 任务已完成，停止轮询');
                this.finishImageGeneration(completedCount, failedCount);
            }
            
        } catch (error) {
            console.error('🔧 强制同步状态失败:', error);
        }
    }
    
    scrollToBottom() {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    // Debug method: clear local storage
    clearStorage() {
        localStorage.removeItem('canvasflow_chats');
        localStorage.removeItem('canvasflow_current_chat');
        console.log('Local storage cleared');
    }
    
    // 🔍 Debug method: 验证三种切换情况的状态完整性
    debugImageGenerationState() {
        console.log('🔍 Current Image Generation State:', {
            // 基础状态
            currentChatId: this.currentChatId,
            generationChatId: this.generationChatId,
            currentTaskId: this.currentTaskId,
            preparingGeneration: this.preparingGeneration,
            
            // UI引用
            hasCurrentImageGrid: !!this.currentImageGrid,
            hasCurrentImageBubble: !!this.currentImageBubble,
            
            // 定时器状态
            pollingTimerId: !!this.pollingTimerId,
            backgroundPollingTimerId: !!this.backgroundPollingTimerId,
            
            // DOM状态
            imageGridsCount: document.querySelectorAll('.image-grid').length,
            activeGridsCount: document.querySelectorAll('.image-grid.active').length,
            historicalGridsCount: document.querySelectorAll('.image-grid.historical').length,
            
            // 图片状态
            placeholdersInfo: this.getPlaceholdersInfo(),
            
            // 按钮状态
            actionButtonsCount: document.querySelectorAll('.image-action-buttons').length,
            
            // 🆕 聊天历史检查
            chatHistoryCheck: this.debugChatHistory()
        });
    }
    
    // 🔍 Debug method: 检查聊天历史中的图片生成消息
    debugChatHistory() {
        const chat = this.chats[this.currentChatId];
        if (!chat || !chat.messages.length) {
            return 'No chat history';
        }
        
        const imageMessages = [];
        for (let i = chat.messages.length - 1; i >= 0; i--) {
            const message = chat.messages[i];
            if (message.role === 'assistant' && 
                (message.content.includes('Image generation result:') ||
                 message.content.includes('Generating four beautiful images') ||
                 message.content.includes('Generating diverse images') ||
                 message.content.includes('task_id:'))) {
                
                imageMessages.push({
                    index: i,
                    preview: message.content.substring(0, 100) + '...',
                    containsTaskId: message.content.includes('task_id:'),
                    containsImageUrls: message.content.includes('/static/generated_images/'),
                    containsGeneratingStatus: message.content.includes('generating') || message.content.includes('pending')
                });
            }
        }
        
        return imageMessages.length > 0 ? imageMessages : 'No image generation messages found';
    }
    
    getPlaceholdersInfo() {
        const grids = document.querySelectorAll('.image-grid');
        if (grids.length === 0) return 'No grids found';
        
        const lastGrid = grids[grids.length - 1];
        const placeholders = lastGrid.querySelectorAll('.image-placeholder');
        
        const info = {
            total: placeholders.length,
            completed: 0,
            generating: 0,
            pending: 0,
            failed: 0
        };
        
        placeholders.forEach(p => {
            if (p.classList.contains('completed')) info.completed++;
            else if (p.classList.contains('generating')) info.generating++;
            else if (p.classList.contains('pending') || p.textContent.includes('Pending')) info.pending++;
            else if (p.classList.contains('failed')) info.failed++;
        });
        
        return info;
    }
}

// 初始化应用
let canvasFlow;
document.addEventListener('DOMContentLoaded', () => {
    canvasFlow = new CanvasFlow();
});

// 🔍 Global debug functions
window.debugImageGeneration = function() {
    if (canvasFlow) {
        canvasFlow.debugImageGenerationState();
    } else {
        console.log('CanvasFlow not initialized yet');
    }
};

// 🔧 Global manual restore function
window.manualRestoreImageGeneration = function() {
    if (canvasFlow) {
        console.log('🔧 手动触发图片生成恢复');
        canvasFlow.checkAndRestoreImageGeneration();
    } else {
        console.log('CanvasFlow not initialized yet');
    }
};

// 🔍 Global function to check current chat history
window.checkCurrentChatHistory = function() {
    if (canvasFlow) {
        const chat = canvasFlow.chats[canvasFlow.currentChatId];
        if (chat && chat.messages.length > 0) {
            console.log('🔍 当前聊天历史记录:');
            chat.messages.forEach((msg, index) => {
                if (msg.role === 'assistant' && (
                    msg.content.includes('Image generation result:') ||
                    msg.content.includes('Generating') ||
                    msg.content.includes('task_id:')
                )) {
                    console.log(`消息 ${index}:`, msg.content);
                }
            });
        } else {
            console.log('没有找到聊天历史记录');
        }
    } else {
        console.log('CanvasFlow not initialized yet');
    }
};

// 🔧 Global function to force sync image generation state
window.forceSyncImageState = function() {
    if (canvasFlow) {
        const imageGrids = document.querySelectorAll('.image-grid');
        if (imageGrids.length > 0) {
            const lastImageGrid = imageGrids[imageGrids.length - 1];
            const messageBubble = lastImageGrid.closest('.message');
            if (messageBubble) {
                console.log('🔧 手动强制同步图片生成状态');
                canvasFlow.forceSyncImageGenerationState(lastImageGrid, messageBubble);
            } else {
                console.log('未找到消息气泡');
            }
        } else {
            console.log('未找到图片网格');
        }
    } else {
        console.log('CanvasFlow not initialized yet');
    }
}; 