prepare-gh: ## Create GitHub repo and enable Pages deployment via Actions
	@gh repo create --public --source=. --remote=origin --ssh 2>/dev/null || true
	@gh api --method POST /repos/{owner}/{repo}/pages \
		-f build_type=workflow > /dev/null 2>&1 \
	|| gh api --method PUT /repos/{owner}/{repo}/pages \
		-f build_type=workflow > /dev/null
	@echo "GitHub repo created and Pages enabled via Actions."

# These make tasks allow the default help text to work properly.
%:
	@true

.PHONY: help prepare-gh

help:
	@echo 'Usage: make <command>'
	@echo
	@echo 'where <command> is one of the following:'
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
