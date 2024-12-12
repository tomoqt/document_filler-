from openai import OpenAI
from ..config import get_settings
from typing import List, Dict, Tuple
import json
import os
import re

class OpenAIService:
    api_call_count = 0

    def __init__(self):
        self.client = OpenAI(api_key='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')
        self.model = get_settings().gpt_model_name
        print(f"[OpenAIService] Initialized with model: {self.model}")

    def fill_blanks(self, document_text: str, context: str, example: str = None, batch_size: int = 15) -> str:
        print(f"\n[fill_blanks] Starting with batch_size: {batch_size}")
        print(f"[fill_blanks] Document length: {len(document_text)} characters")

        # First, identify all blanks in the document
        blanks = self._identify_blanks(document_text)
        print(f"[fill_blanks] Found {len(blanks)} blanks to fill")
        
        if not blanks:
            print("[fill_blanks] No blanks found in document")
            return document_text

        # Then, fill all identified blanks
        filled_text = self._fill_identified_blanks(document_text, blanks, context, example)
        
        print(f"\n[fill_blanks] Summary:")
        print(f"[fill_blanks] - Total blanks processed: {len(blanks)}")
        print(f"[fill_blanks] - Total API calls made: {OpenAIService.api_call_count}")
        print(f"[fill_blanks] - Final document length: {len(filled_text)} characters")
        
        return filled_text

    def _identify_blanks(self, text: str) -> List[str]:
        print("[identify_blanks] Starting blank identification")
        
        prompt = """
Please identify all blanks (text in square brackets or underscores) in the following document.
Return them as a JSON array of strings, preserving the exact format (including brackets if present).

Document:
{}

Return format example:
{{
    "blanks": [
        "[Name]",
        "[Position]",
        "___________",
        "[Date of Birth]"
    ]
}}
""".format(text)
        
        try:
            OpenAIService.api_call_count += 1
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that identifies blanks in documents. Return only the JSON array of blanks found."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            result = json.loads(completion.choices[0].message.content)
            blanks = result.get('blanks', [])
            print(f"[identify_blanks] Found {len(blanks)} blanks: {blanks}")
            return blanks
            
        except Exception as e:
            print(f"[identify_blanks] Error during blank identification: {str(e)}")
            raise

    def _fill_identified_blanks(self, text: str, blanks: List[str], context: str, example: str = None) -> str:
        print(f"[fill_identified_blanks] Starting to fill {len(blanks)} blanks")
        
        prompt = f"""
Please provide filled values for the following blanks based on the context provided.
Return a JSON object mapping each blank to its filled value.

Blanks to fill:
{json.dumps(blanks, indent=2)}

Context:
{context}

Return format example:
{{
    "filled_values": {{
        "[Name]": "John Smith",
        "[Position]": "CEO",
        "___________": "2024-03-15"
    }}
}}
"""

        if example:
            prompt += f"\nExample:\n{example}"

        try:
            OpenAIService.api_call_count += 1
            completion = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant that fills in document blanks based on context."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            
            result = json.loads(completion.choices[0].message.content)
            filled_values = result.get('filled_values', {})
            
            # Apply the filled values to the text
            filled_text = text
            for blank, value in filled_values.items():
                print(f"[fill_identified_blanks] Replacing '{blank}' with '{value}'")
                filled_text = filled_text.replace(blank, value)
            
            return filled_text
            
        except Exception as e:
            print(f"[fill_identified_blanks] Error during filling: {str(e)}")
            raise