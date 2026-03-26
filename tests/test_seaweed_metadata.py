from ufabc_chatbot.infrastructure.storage.seaweed_s3_storage import SeaweedS3Storage


def test_seaweed_metadata_is_normalized_to_ascii() -> None:
    metadata = {
        "document_tipo": "Instrução",
        "document_dominio": "Educação",
        "autor": "Pró-Reitoria",
    }
    normalized = SeaweedS3Storage._normalize_metadata(metadata)

    assert normalized["document-tipo"] == "Instrucao"
    assert normalized["document-dominio"] == "Educacao"
    assert normalized["autor"] == "Pro-Reitoria"

