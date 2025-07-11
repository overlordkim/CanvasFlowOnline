#!/usr/bin/env python3
"""
Test the new diversity prompt generation system
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import generate_diverse_prompts

def test_diversity_generation():
    """Test diversity generation effects"""
    
    print("🧪 Testing new diversity prompt generation system")
    print("=" * 60)
    
    # Test case 1: Basic descriptions
    test_prompts = [
        "A cute kitten, cyberpunk style, mechanical modification elements, neon colors, futuristic city background",
        "Beautiful female character, wearing elegant dress, walking in garden, sunlight through leaves",
        "A brave warrior, holding glowing sword, standing on mountain peak, facing sunset"
    ]
    
    for i, base_prompt in enumerate(test_prompts, 1):
        print(f"\n📝 Test Case {i}:")
        print(f"Base description: {base_prompt}")
        print("-" * 40)
        
        try:
            diverse_prompts = generate_diverse_prompts(base_prompt)
            
            print(f"✅ Successfully generated {len(diverse_prompts)} diversified prompts:")
            
            for j, prompt in enumerate(diverse_prompts, 1):
                print(f"\nPrompt {j}:")
                print(f"  {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
                
                # Analyze diversity characteristics
                style_keywords = {
                    'realistic': ['realistic', 'photography', 'cinematic', 'photorealistic'],
                    'anime': ['anime', 'manga', 'cel-shading', 'Studio Ghibli'],
                    'painting': ['painting', 'oil painting', 'watercolor', 'brushstrokes'],
                    'concept': ['concept art', 'futuristic', 'sci-fi', 'digital painting']
                }
                
                detected_styles = []
                for style, keywords in style_keywords.items():
                    if any(keyword.lower() in prompt.lower() for keyword in keywords):
                        detected_styles.append(style)
                
                if detected_styles:
                    print(f"  Detected styles: {', '.join(detected_styles)}")
                
        except Exception as e:
            print(f"❌ Generation failed: {e}")
    
    print("\n" + "=" * 60)
    print("🎯 Testing completed!")

if __name__ == "__main__":
    test_diversity_generation() 