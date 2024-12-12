from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    openai_api_key: str
    gpt_model_name: str = "gpt-4o-mini"
    
    class Config:
        env_file = ".env"
        protected_namespaces = ('settings_',)

@lru_cache()
def get_settings():
    return Settings() 