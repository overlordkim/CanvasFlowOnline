#!/usr/bin/env python3
"""
Simple script to test image generation functionality
"""
import requests
import json
import time
import sys
import os

# Add current directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_image_generation():
    """Test image generation API"""
    
    # Test if API is available
    print("🔍 Testing health check...")
    try:
        response = requests.get('http://localhost:5000/api/health')
        if response.status_code == 200:
            print("✅ Server running normally")
        else:
            print("❌ Server health check failed")
            return False
    except Exception as e:
        print(f"❌ Cannot connect to server: {e}")
        return False
    
    # Test image generation
    print("\n🎨 Starting image generation test...")
    test_prompt = "A beautiful cat sitting in a sunny garden, photorealistic, high quality"
    
    try:
        # Send image generation request
        response = requests.post('http://localhost:5000/api/generate_images', 
                               json={
                                   'prompt': test_prompt,
                                   'chat_id': 'test_chat'
                               })
        
        if response.status_code != 200:
            print(f"❌ Image generation request failed: {response.status_code}")
            return False
        
        data = response.json()
        task_id = data.get('task_id')
        
        if not task_id:
            print("❌ No task ID received")
            return False
        
        print(f"✅ Task submitted, ID: {task_id}")
        
        # Poll task status
        print("\n⏳ Waiting for image generation...")
        max_wait = 300  # 5 minutes
        poll_interval = 5
        elapsed = 0
        
        while elapsed < max_wait:
            try:
                status_response = requests.get(f'http://localhost:5000/api/generate_images/{task_id}')
                
                if status_response.status_code == 200:
                    status_data = status_response.json()
                    print(f"Status: {status_data['status']}")
                    
                    # Show status of each image
                    for i, img in enumerate(status_data['images']):
                        print(f"  Image {i+1}: {img['status']}")
                    
                    if status_data['status'] == 'completed':
                        print("🎉 All images generated successfully!")
                        
                        # Show results
                        for i, img in enumerate(status_data['images']):
                            if img['status'] == 'completed' and img['url']:
                                print(f"  Image {i+1}: {img['url']}")
                        
                        return True
                    elif status_data['status'] == 'failed':
                        print("❌ Image generation failed")
                        return False
                    
                else:
                    print(f"❌ Failed to get status: {status_response.status_code}")
                    return False
                    
            except Exception as e:
                print(f"⚠️ Error during status polling: {e}")
            
            time.sleep(poll_interval)
            elapsed += poll_interval
            
        print("❌ Timeout: Image generation exceeded maximum wait time")
        return False
        
    except Exception as e:
        print(f"❌ Error during testing: {e}")
        return False

if __name__ == "__main__":
    print("🚀 Starting image generation functionality test...")
    print("Please ensure server is running: python app.py")
    print("=" * 50)
    
    success = test_image_generation()
    
    print("=" * 50)
    if success:
        print("✅ Image generation functionality test successful!")
    else:
        print("❌ Image generation functionality test failed!")
        
    print("\n💡 Tips:")
    print("- Ensure server is running")
    print("- Check network connection")
    print("- Confirm API key configuration is correct")
    print("- Check server logs for detailed error information") 