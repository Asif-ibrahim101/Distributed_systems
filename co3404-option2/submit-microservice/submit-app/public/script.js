const form = document.getElementById('joke-form');
const setupInput = document.getElementById('setup');
const punchlineInput = document.getElementById('punchline');
const typeSelect = document.getElementById('type-select');
const newTypeToggle = document.getElementById('new-type-toggle');
const newTypeInput = document.getElementById('new-type-input');
const feedback = document.getElementById('feedback');

/**
 * Fetch all joke types from the server and populate the dropdown.
 * Called every time the dropdown is clicked/focused so it stays current.
 */
async function loadTypes() {
    try {
        const res = await fetch('/submit-types');
        const types = await res.json();

        // Deduplicate types
        const uniqueTypes = [...new Set(types)];

        const currentValue = typeSelect.value;

        // Rebuild dropdown options
        typeSelect.innerHTML = '<option value="">-- Select a type --</option>';
        uniqueTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type.charAt(0).toUpperCase() + type.slice(1);
            typeSelect.appendChild(option);
        });

        // Restore previous selection if still valid
        if ([...typeSelect.options].some(opt => opt.value === currentValue)) {
            typeSelect.value = currentValue;
        }
    } catch (err) {
        console.error('Failed to load types:', err);
    }
}

/**
 * Toggle visibility of the new type text input.
 * When toggled on, hide the dropdown; when off, hide the text input.
 */
newTypeToggle.addEventListener('change', () => {
    if (newTypeToggle.checked) {
        typeSelect.classList.add('hidden');
        newTypeInput.classList.remove('hidden');
        newTypeInput.focus();
    } else {
        typeSelect.classList.remove('hidden');
        newTypeInput.classList.add('hidden');
        newTypeInput.value = '';
    }
});

/**
 * Handle form submission — validates fields and sends data to POST /submit.
 */
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const setup = setupInput.value.trim();
    const punchline = punchlineInput.value.trim();
    const isNewType = newTypeToggle.checked;
    const type = isNewType ? newTypeInput.value.trim() : typeSelect.value;

    // Client-side validation: all fields must be filled
    if (!setup || !punchline || !type) {
        showFeedback('Please fill in all fields (setup, punchline, and type).', 'error');
        return;
    }

    try {
        const res = await fetch('/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ setup, punchline, type, isNewType }),
        });

        const data = await res.json();

        if (res.ok) {
            showFeedback(data.message, 'success');
            // Reset the form after a successful submission
            form.reset();
            newTypeInput.classList.add('hidden');
            typeSelect.classList.remove('hidden');
            // Refresh types so the new type appears in the dropdown
            loadTypes();
        } else {
            showFeedback(data.error || 'Submission failed.', 'error');
        }
    } catch (err) {
        console.error('Submit error:', err);
        showFeedback('Network error. Please try again.', 'error');
    }
});

/**
 * Display success or error feedback to the user.
 */
function showFeedback(message, type) {
    feedback.textContent = message;
    feedback.className = `feedback ${type}`;
    feedback.classList.remove('hidden');

    // Auto-hide success messages after 5 seconds
    if (type === 'success') {
        setTimeout(() => feedback.classList.add('hidden'), 5000);
    }
}

// Refresh types when the dropdown receives focus
typeSelect.addEventListener('focus', loadTypes);

// Load types on initial page load
loadTypes();
