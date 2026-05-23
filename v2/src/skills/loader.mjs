/**
 * Skills Loader — loads skills from .claude/skills/{name}/SKILL.md
 *
 * Skills are invoked via /skill-name in REPL or the Skill tool.
 * Each skill has a SKILL.md that defines:
 * - name, description, trigger conditions
 * - The prompt to inject when the skill is invoked
 */

import fs from 'fs';
import path from 'path';

export class SkillsLoader {
    constructor() {
        this.skills = new Map();
        this.searchPaths = [];
    }

    /**
     * Load skills from standard directories.
     *
     * When cwd equals process.cwd() (the default), also loads skills from the
     * user's global ~/.claude/skills directory so that user-installed skills
     * are always available.  When an explicit alternative cwd is provided,
     * only that directory's .claude/skills is searched — this keeps unit tests
     * hermetic and avoids leaking host-machine skills into isolated environments.
     *
     * @param {string} [cwd] - project working directory
     */
    load(cwd = process.cwd()) {
        const isDefaultCwd = cwd === process.cwd();
        this.searchPaths = [path.join(cwd, '.claude', 'skills')];

        if (isDefaultCwd) {
            const globalSkills = path.join(process.env.HOME || '', '.claude', 'skills');
            if (globalSkills !== this.searchPaths[0]) {
                this.searchPaths.push(globalSkills);
            }
        }

        for (const dir of this.searchPaths) {
            this._loadFromDir(dir);
        }

        return this;
    }

    _loadFromDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const skillFile = path.join(dir, entry.name, 'SKILL.md');
                try {
                    const content = fs.readFileSync(skillFile, 'utf-8');
                    const skill = parseSkill(content, entry.name);
                    if (skill) {
                        skill.source = skillFile;
                        this.skills.set(skill.name, skill);
                    }
                } catch {
                    // Skill directory without SKILL.md, skip
                }
            }
        } catch {
            // Directory does not exist
        }
    }

    /**
     * Get a skill by name.
     * @param {string} name
     * @returns {object|null}
     */
    get(name) {
        // Try exact match, then prefix match
        if (this.skills.has(name)) return this.skills.get(name);
        for (const [key, skill] of this.skills) {
            if (key.startsWith(name) || skill.aliases?.includes(name)) {
                return skill;
            }
        }
        return null;
    }

    /**
     * List all loaded skills.
     * @returns {Array<object>}
     */
    list() {
        return [...this.skills.values()];
    }

    /**
     * Run a skill, returning its prompt for injection into the conversation.
     * @param {string} name - skill name
     * @param {string} [args] - optional arguments
     * @returns {string} skill prompt
     */
    async run(name, args) {
        const skill = this.get(name);
        if (!skill) {
            throw new Error(`Unknown skill: ${name}`);
        }

        let prompt = skill.prompt;
        if (args) {
            prompt = prompt.replace('$ARGUMENTS', args);
            prompt += `\n\nArguments: ${args}`;
        }

        return `[Skill: ${skill.name}]\n${prompt}`;
    }
}

/**
 * Parse a SKILL.md file into a skill definition.
 */
function parseSkill(content, dirName) {
    const lines = content.split('\n');
    const skill = {
        name: dirName,
        description: '',
        aliases: [],
        trigger: null,
        prompt: content,
    };

    // Parse YAML frontmatter if present
    if (lines[0]?.trim() === '---') {
        const endIdx = lines.indexOf('---', 1);
        if (endIdx > 0) {
            const frontmatter = lines.slice(1, endIdx).join('\n');
            for (const line of frontmatter.split('\n')) {
                const colonIdx = line.indexOf(':');
                if (colonIdx === -1) continue;
                const key = line.slice(0, colonIdx).trim();
                const value = line.slice(colonIdx + 1).trim();

                if (key === 'name') skill.name = value;
                else if (key === 'description') skill.description = value;
                else if (key === 'trigger') skill.trigger = value;
                else if (key === 'aliases') {
                    skill.aliases = value.replace(/[\[\]]/g, '').split(',').map(s => s.trim());
                }
            }
            skill.prompt = lines.slice(endIdx + 1).join('\n').trim();
        }
    }

    // Extract description from first paragraph if not in frontmatter
    if (!skill.description && skill.prompt) {
        const firstLine = skill.prompt.split('\n').find(l => l.trim() && !l.startsWith('#'));
        if (firstLine) skill.description = firstLine.trim().slice(0, 100);
    }

    return skill;
}
