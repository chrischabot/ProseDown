.PHONY: help install install-web install-rust typecheck build dev check test clean fmt preview

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: install-web install-rust ## Install all dependencies

install-web:  ## Install web (npm) dependencies
	npm --prefix web ci

install-rust: ## Fetch Rust dependencies
	cargo fetch

typecheck:    ## Run TypeScript in no-emit mode
	npm --prefix web run typecheck

check:        ## cargo check the Rust crate
	cargo check -p prosedown

test:         ## Run the renderer unit tests (vitest)
	npm --prefix web test -- --run

build:        ## Full release build — web bundle + signed .app/.dmg
	npm --prefix web run build
	cargo tauri build

dev:          ## Tauri dev with hot-reloading webview
	cargo tauri dev

preview:      ## Serve the built web/dist at http://localhost:8080 for browser-only testing
	npm --prefix web run preview

fmt:          ## Format Rust sources
	cargo fmt

clean:        ## Remove build artefacts
	rm -rf web/dist web/node_modules/.vite target src-tauri/target src-tauri/gen