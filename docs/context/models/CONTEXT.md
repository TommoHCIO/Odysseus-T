# Models Context

This context names AI models and how they run.

## Language

**Model**:
A named AI ability Odysseus can use, such as chat, embeddings, vision, image, or speech.
_Avoid_: Provider endpoint, server

**Default Model**:
The model Odysseus uses when no more specific model is chosen.
_Avoid_: Served model

**Teacher Model**:
A stronger model used for help on harder tasks.
_Avoid_: Default model

**Embedding Model**:
A model that turns text into vectors for search or recall.
_Avoid_: Chat model

**Vision Model**:
A model that can understand images.
_Avoid_: Image generation model

**Image Model**:
A model that creates or edits images.
_Avoid_: Vision model

**Downloaded Model**:
A model whose files are present, but may not be running.
_Avoid_: Served model

**Served Model**:
A model that is running behind an endpoint and can be called by Odysseus.
_Avoid_: Downloaded model, provider endpoint

**Hardware Fit**:
How well a model should work on a machine and runtime path.
_Avoid_: Compatibility, score

**Runtime Path**:
The way a model becomes callable, such as Ollama, llama.cpp, vLLM, SGLang, or a remote provider endpoint.
_Avoid_: Backend, server

**Cookbook**:
The Odysseus place for choosing, downloading, setting up, and serving models based on hardware fit.
_Avoid_: Model catalog, download page
