from pydantic import BaseModel, ConfigDict


class CurrencyOut(BaseModel):
    """Schema for currency master records returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    currency_code: str
    currency_name: str
