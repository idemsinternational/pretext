const timeOutHandler = new Object();
const inputPrefix = 'stackapi_input_';
const feedbackPrefix = 'stackapi_fb_';
const validationPrefix = 'stackapi_val_';
let mathjaxPromise = Promise.resolve();
const requestLanguage = 'en';
// const stack_api_url = // This is pulled from the publication file


const stackstring = {
  "teacheranswershow_mcq":"A correct answer is: {$a->display}",
  "api_which_typed":"which can be typed as follows",
  "api_valid_all_parts":"Please enter valid answers for all parts of the question.",
  "api_out_of":"out of",
  "api_marks_sub":"Marks for this submission",
  "api_submit":"Submit Answers",
  "generalfeedback":"General feedback",
  "score":"Score",
  "api_response":"Response summary",
  "api_correct":"Correct answers",
  "api_questionnote": "Question note",
};


function wrap_math(content) {
  // Wrap instances of \[ ... \] and \( ... \) into the tags configured to be processed by MathJax
  // Here we make sure that the backslashes are not escaped like \\[ 
  content = content.replace(/(?<!\\)(\\\(.*?(?<!\\)\\\))/gs, "<span class=\"process-math\">$1</span>");
  return content.replace(/(?<!\\)(\\\[.*?(?<!\\)\\\])/gs, "<span class=\"process-math\">$1</span>");
}

// Create data for call to API.
async function collectData(qfile, qname, qprefix) {
  let res = "";

    await getQuestionFile(qfile, qname).then((response)=>{
      if (response.questionxml != "<quiz>\nnull\n</quiz>") {
        res = {
          questionDefinition: response.questionxml,
          answers: collectAnswer(qprefix),
          seed: response.seed,
          renderInputs: qprefix + inputPrefix,
          readOnly: false,
        };
      };
    });
  // }
  return res;
}

// Get the different input elements by tag and return object with values.
function collectAnswer(qprefix) {
  const inputs = document.getElementsByTagName('input');
  const textareas = document.getElementsByTagName('textarea');
  const selects = document.getElementsByTagName('select');
  let res = {};
  res = processNodes(res, inputs, qprefix);
  res = processNodes(res, textareas, qprefix);
  res = processNodes(res, selects, qprefix);
  return res;
}

// Return object of values of valid entries in an HTMLCollection.
// Store _val fields with their full name (stripped of qprefix+inputPrefix) so the API receives them correctly.
function processNodes(res, nodes, qprefix) {
  for (let i = 0; i < nodes.length; i++) {
    const element = nodes[i];
    if (element.name.indexOf(qprefix + inputPrefix) === 0 && !element.name.endsWith('_val')) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        if (element.checked) {
          res[element.name.slice((qprefix + inputPrefix).length)] = element.value;
        }
      } else {
        res[element.name.slice((qprefix + inputPrefix).length)] = element.value;
      }
    }
    if (element.name.indexOf(qprefix + inputPrefix) === 0 && element.name.endsWith('_val')) {
      res[element.name.slice((qprefix + inputPrefix).length)] = element.value;
    }
  }
  return res;
}

// Show or hide a loading state on the question identified by qprefix.
function loading(qprefix, isLoading) {
  const container = document.getElementById(`${qprefix}stack`);
  if (!container) return;
  const buttons = container.querySelectorAll('input[type="button"]');
  const spinner = document.getElementById(`${qprefix}stackapi_spinner`);
  for (const btn of buttons) {
    btn.disabled = isLoading;
  }
  if (spinner) {
    spinner.style.display = isLoading ? 'inline' : 'none';
  }
}

// Display rendered question and solution.
function send(qfile, qname, qprefix) {
  loading(qprefix, true);
  const http = new XMLHttpRequest();
  const url = stack_api_url + '/render';
  http.open("POST", url, true);
  http.setRequestHeader('Content-Type', 'application/json');
  http.setRequestHeader('Accept-Language', requestLanguage);
  http.onreadystatechange = function() {
    if(http.readyState == 4) {
      loading(qprefix, false);
      try {
        const json = JSON.parse(http.responseText);
        if (json.message) {
          console.log(json);
          document.getElementById(`${qprefix+"errors"}`).innerText = json.message;
          return;
        } else {
          document.getElementById(`${qprefix+"errors"}`).innerText = '';
        }
        renameIframeHolders();
        let question = json.questionrender;
        const inputs = json.questioninputs;
        const seed = json.questionseed;
        let correctAnswers = '';


        // Use matchAll to replace inputs in document order, preventing substring collisions
        // (e.g. 'ans1' matching inside 'ans10'). 
        const placeholders = question.matchAll(/\[\[input:([a-zA-Z][a-zA-Z0-9_]*)\]\]/g);
        for (const holder of placeholders) {
          const name = holder[1];
          const input = inputs[name];
          if (!input) continue;

          question = question.replace(`[[input:${name}]]`, input.render);
          question = question.replace(`[[validation:${name}]]`, `<span name='${qprefix + validationPrefix + name}'></span>`);
          question = question.replace(/javascript:download\(([^,]+?),([^,]+?)\)/, `javascript:download($1,$2, '${qfile}', '${qname}', '${qprefix}', ${seed})`);
          question = wrap_math(question);

          if (input.samplesolutionrender && name !== 'remember') {
            correctAnswers += `<p>A correct answer is: `;
            if (input.samplesolutionrender.substring(0, 1) === '<') {
              correctAnswers += input.samplesolutionrender;
            } else {
              correctAnswers += `\\[{${input.samplesolutionrender}}\\]`;
            }
            if (input.samplesolution) {
              let answerOutput = "";
              for (const [name, solution] of Object.entries(input.samplesolution)) {
                if (!name.endsWith('_val') &&
                    !(typeof solution === 'string' && solution.startsWith('[[{"used":'))) {
                  answerOutput += `<span class='correct-answer'>${wrap_math(solution.replace(/\n/g, '<br>'))}</span>`;
                }
              }
              if (answerOutput) {
                correctAnswers += `, ${stackstring['api_which_typed']}: ` + answerOutput;
              }
            }
            correctAnswers += '.</p>';
          } else if (name !== 'remember' && input.samplesolution) {
            // For dropdowns, radio buttons, etc., only the correct option is displayed.
            for (const solution of Object.values(input.samplesolution)) {
              if (input.configuration.options) {
                correctAnswers += `<p class='correct-answer'>${input.configuration.options[solution]}</p>`;
              }
            }
          }
        }

        // Show or hide the submit button area depending on whether the question has inputs.
        const elementsRequiringInputs = document.getElementById(`${qprefix}stackapi_qtext`)
          .querySelectorAll('.noninfo');
        if (Object.keys(inputs).length) {
          for (const el of elementsRequiringInputs) {
            el.style.display = 'inline-block';
          }
        } else {
          for (const el of elementsRequiringInputs) {
            el.style.display = 'none';
          }
        }

      // Convert Moodle plot filenames to API filenames.
        for (const [name, file] of Object.entries(json.questionassets)) {
          const plotUrl = getPlotUrl(file);
          question = question.replace(name, plotUrl);
          json.questionsamplesolutiontext = json.questionsamplesolutiontext.replace(name, plotUrl);
          if (json.questionnote) {
            json.questionnote = json.questionnote.replace(name, plotUrl);
          }
          correctAnswers = correctAnswers.replace(name, plotUrl);
        }

        question = replaceFeedbackTags(question, qprefix);
        const qoutput = document.getElementById(`${qprefix + 'output'}`);
        qoutput.innerHTML = question;
        document.getElementById(`${qprefix + 'stackapi_qtext'}`).style.display = 'block';

        // Set up a validation call on inputs. Timeout length is reset if the input is
        // updated before the validation call is made.
        for (const inputName of Object.keys(inputs)) {
          const inputElements = document.querySelectorAll(`[name^=${qprefix + inputPrefix + inputName}]`);
          for (const inputElement of Object.values(inputElements)) {
            inputElement.oninput = (event) => {
              const currentTimeout = timeOutHandler[event.target.id];
              if (currentTimeout) {
                window.clearTimeout(currentTimeout);
              }
              timeOutHandler[event.target.id] = window.setTimeout(validate.bind(null, event.target, qfile, qname, qprefix), 1000);
            };
          }
        }

        let sampleText = json.questionsamplesolutiontext;
        if (sampleText) {
          sampleText = replaceFeedbackTags(sampleText, qprefix);
          document.getElementById(`${qprefix + 'generalfeedback'}`).innerHTML = wrap_math(sampleText);
        } else {
          document.getElementById(`${qprefix + 'generalfeedback'}`).innerHTML = '';
        }

        // Display question note if present.
        const questionNoteContainer = document.getElementById(`${qprefix + 'stackapi_questionnote'}`);
        if (questionNoteContainer) {
          if (json.questionnote) {
            document.getElementById(`${qprefix + 'questionnote'}`).innerHTML = wrap_math(json.questionnote);
            questionNoteContainer.style.display = 'block';
          } else {
            questionNoteContainer.style.display = 'none';
          }
        }

        // Hide result sections until the student submits an answer.
        document.getElementById(`${qprefix + 'stackapi_generalfeedback'}`).style.display = 'none';
        document.getElementById(`${qprefix + 'stackapi_score'}`).style.display = 'none';
        document.getElementById(`${qprefix + 'stackapi_summary'}`).style.display = 'none';
        document.getElementById(`${qprefix + 'stackapi_correct'}`).style.display = 'none';

        document.getElementById(`${qprefix + 'stackapi_validity'}`).innerText = '';
        const innerFeedback = document.getElementById(`${qprefix + 'specificfeedback'}`);
        innerFeedback.innerHTML = '';
        innerFeedback.classList.remove('feedback');
        document.getElementById(`${qprefix + 'formatcorrectresponse'}`).innerHTML = correctAnswers;

        createIframes(json.iframes);
        triggerMathJax();
      }
      catch (e) {
        console.log(e);
        document.getElementById(`${qprefix + 'errors'}`).innerText = http.responseText;
        return;
      }
    }
  };


  collectData(qfile, qname, qprefix).then((data) => {
    const submitbutton = document.getElementById(`${qprefix + 'stackapi_qtext'}`).querySelector('input[type="button"]');
    submitbutton.addEventListener('click', function () { answer(qfile, qname, qprefix, data.seed); }, {once: true});
    delete data.answers;
    http.send(JSON.stringify(data));
    const questioncontainer = document.getElementById(`${qprefix + 'stack'}`).parentElement;
    if (questioncontainer.getBoundingClientRect().top < 0) {
      questioncontainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

// Validate an input. Called a set amount of time after an input is last updated.
function validate(element, qfile, qname, qprefix) {
  const http = new XMLHttpRequest();
  const url = stack_api_url + '/validate';
  http.open("POST", url, true);
  const answerNamePrefixTrim = (qprefix + inputPrefix).length;
  const answerName = element.name.slice(answerNamePrefixTrim).split('_', 1)[0];
  http.setRequestHeader('Content-Type', 'application/json');
  http.setRequestHeader('Accept-Language', requestLanguage);
  http.onreadystatechange = function () {
    if (http.readyState == 4) {
      try {
        const json = JSON.parse(http.responseText);
        if (json.message) {
          document.getElementById(`${qprefix + 'errors'}`).innerText = json.message;
          return;
        } else {
          document.getElementById(`${qprefix + 'errors'}`).innerText = '';
        }
        renameIframeHolders();
        const validationHTML = json.validation;
        const validationElement = document.getElementsByName(`${qprefix + validationPrefix + answerName}`)[0];
        validationElement.innerHTML = wrap_math(validationHTML);
        if (validationHTML) {
          validationElement.classList.add('validation');
        } else {
          validationElement.classList.remove('validation');
        }
        createIframes(json.iframes);
        triggerMathJax();
      }
      catch (e) {
        document.getElementById(`${qprefix + 'errors'}`).innerText = http.responseText;
        return;
      }
    }
  };
  collectData(qfile, qname, qprefix).then((data) => {
    data.inputName = answerName;
    http.send(JSON.stringify(data));
  });
}

// Submit answers.
function answer(qfile, qname, qprefix, seed) {
  loading(qprefix, true);
  const http = new XMLHttpRequest();
  const url = stack_api_url + '/grade';
  http.open("POST", url, true);

  if (!document.getElementById(`${qprefix + 'output'}`).innerText) {
    loading(qprefix, false);
    return;
  }

  http.setRequestHeader('Content-Type', 'application/json');
  http.setRequestHeader('Accept-Language', requestLanguage);
  http.onreadystatechange = function () {
    if (http.readyState == 4) {
      loading(qprefix, false);
      try {
        const json = JSON.parse(http.responseText);
        if (json.message) {
          document.getElementById(`${qprefix + 'errors'}`).innerText = json.message;
          return;
        } else {
          document.getElementById(`${qprefix + 'errors'}`).innerText = '';
        }
        if (!json.isgradable) {
          document.getElementById(`${qprefix + 'stackapi_validity'}`).innerText
            = ' ' + stackstring["api_valid_all_parts"];
          return;
        }
        renameIframeHolders();

        // Show score.
        document.getElementById(`${qprefix + 'score'}`).innerText
          = (json.score * json.scoreweights.total).toFixed(2) +
          ' ' + stackstring["api_out_of"] + ' ' + json.scoreweights.total;
        document.getElementById(`${qprefix + 'stackapi_score'}`).style.display = 'block';

        // Show response summary.
        document.getElementById(`${qprefix + 'response_summary'}`).innerText = json.responsesummary;
        document.getElementById(`${qprefix + 'stackapi_summary'}`).style.display = 'block';

        // Show general feedback (solution) after submission.
        document.getElementById(`${qprefix + 'stackapi_generalfeedback'}`).style.display = 'block';

        // Show correct answers after submission.
        document.getElementById(`${qprefix + 'stackapi_correct'}`).style.display = 'block';

        // Handle specific feedback.
        const feedback = json.prts;
        const specificFeedbackElement = document.getElementById(`${qprefix + 'specificfeedback'}`);
        if (json.specificfeedback) {
          for (const [name, file] of Object.entries(json.gradingassets)) {
            json.specificfeedback = json.specificfeedback.replace(name, getPlotUrl(file));
          }
          json.specificfeedback = replaceFeedbackTags(json.specificfeedback, qprefix);
          specificFeedbackElement.innerHTML = wrap_math(json.specificfeedback);
          specificFeedbackElement.classList.add('feedback');
        } else {
          specificFeedbackElement.classList.remove('feedback');
        }

        // Replace plots in PRT feedback and then display.
        for (let [name, fb] of Object.entries(feedback)) {
          for (const [assetName, file] of Object.entries(json.gradingassets)) {
            fb = fb.replace(assetName, getPlotUrl(file));
          }
          const elements = document.getElementsByName(`${qprefix + feedbackPrefix + name}`);
          if (elements.length > 0) {
            const element = elements[0];
            if (json.scores[name] !== undefined && json.scoreweights[name]) {
              fb = fb + `<div>${stackstring['api_marks_sub']}:
                ${(json.scores[name] * json.scoreweights[name] * json.scoreweights.total).toFixed(2)}
                / ${(json.scoreweights[name] * json.scoreweights.total).toFixed(2)}.</div>`;
            }
            element.innerHTML = wrap_math(fb);
            if (fb) {
              element.classList.add('feedback');
            } else {
              element.classList.remove('feedback');
            }
          }
        }

        createIframes(json.iframes);
        triggerMathJax();
      }
      catch (e) {
        console.log(e);
        document.getElementById(`${qprefix + 'errors'}`).innerText = http.responseText;
        return;
      }
    }
  };

  // Clear previous answers and score before submitting.
  const specificFeedbackElement = document.getElementById(`${qprefix + 'specificfeedback'}`);
  specificFeedbackElement.innerHTML = "";
  specificFeedbackElement.classList.remove('feedback');
  document.getElementById(`${qprefix + 'response_summary'}`).innerText = "";
  document.getElementById(`${qprefix + 'stackapi_summary'}`).style.display = 'none';
  document.getElementById(`${qprefix + 'stackapi_score'}`).style.display = 'none';
  document.getElementById(`${qprefix + 'stackapi_correct'}`).style.display = 'none';
  const inputElements = document.querySelectorAll(`[name^=${qprefix + feedbackPrefix}]`);
  for (const inputElement of Object.values(inputElements)) {
    inputElement.innerHTML = "";
    inputElement.classList.remove('feedback');
  }
  document.getElementById(`${qprefix + 'stackapi_validity'}`).innerText = '';

  collectData(qfile, qname, qprefix).then((data) => {
    data.seed = seed;
    http.send(JSON.stringify(data));
  });
}

function download(filename, fileid, qfile, qname, qprefix, seed) {
  const http = new XMLHttpRequest();
  const url = stack_api_url + '/download';
  http.open("POST", url, true);
  http.setRequestHeader('Content-Type', 'application/json');
  http.setRequestHeader('Accept-Language', requestLanguage);
  http.filename = filename;
  http.fileid = fileid;
  http.onreadystatechange = function () {
    if (http.readyState == 4) {
      try {
        const blob = new Blob([http.responseText], { type: 'application/octet-binary', endings: 'native' });
        const selector = CSS.escape(`javascript\:download\(\'${http.filename}\'\, ${http.fileid}\, \'${qfile}\'\, \'${qname}\'\, \'${qprefix}\'\, ${seed}\)`);
        const linkElements = document.querySelectorAll(`a[href^=${selector}]`);
        const link = linkElements[0];
        link.setAttribute('href', URL.createObjectURL(blob));
        link.setAttribute('download', filename);
        link.click();
      }
      catch (e) {
        document.getElementById('errors').innerText = http.responseText;
        return;
      }
    }
  };
  collectData(qfile, qname, qprefix).then((data) => {
    data.filename = filename;
    data.fileid = fileid;
    data.seed = seed;
    http.send(JSON.stringify(data));
  });
}

function saveState(key, value) {
  if (typeof (Storage) !== "undefined") {
    localStorage.setItem(key, value);
  }
}

function loadState(key) {
  if (typeof (Storage) !== "undefined") {
    return localStorage.getItem(key) || '';
  }
  return '';
}

function renameIframeHolders() {
  // Each call to STACK restarts numbering of iframe holders so we need to rename
  // any old ones to make sure new iframes end up in the correct place.
  for (const iframe of document.querySelectorAll(`[id^=stack-iframe-holder]:not([id$=old]`)) {
    iframe.id = iframe.id + '_old';
  }
}

// Spread iframe args with ...iframe instead of manually passing each argument.
function createIframes(iframes) {
  for (const iframe of iframes) {
    iframe[1] = iframe[1].replace('<head>', `<head><base href="${stack_api_url}/" />`);
    create_iframe(...iframe);
  }
}

// Replace feedback tags in some text with an appropriately named HTML div.
function replaceFeedbackTags(text, qprefix) {
  let result = text;
  const feedbackTags = text.match(/\[\[feedback:.*?\]\]/g);
  if (feedbackTags) {
    for (const tag of feedbackTags) {
      result = result.replace(tag, `<div name='${qprefix + feedbackPrefix + tag.slice(11, -2)}'></div>`);
    }
  }
  return result;
}

// Trigger MathJax re-rendering.
function triggerMathJax() {
  if (window.MathJax && MathJax.typesetPromise) {
    mathjaxPromise = mathjaxPromise.then(() => MathJax.typesetPromise()).catch((err) => console.log('MathJax error: ', err.message));
  } else if (window.MathJax) {
    MathJax.typeset();
  }
}

async function getQuestionFile(questionURL, questionName) {
  let res = "";
  if (questionURL) {
    await fetch(questionURL)
      .then(result => result.text())
      .then((result) => {
        res = loadQuestionFromFile(result, questionName);
      });
  }
  return res;
}

function loadQuestionFromFile(fileContents, questionName) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(fileContents, "text/xml");

  let thequestion = null;
  let randSeed = "";
  for (const question of xmlDoc.getElementsByTagName("question")) {
    if (question.getAttribute('type').toLowerCase() === 'stack' && (!questionName || question.querySelectorAll("name text")[0].textContent === questionName)) {
      thequestion = question.outerHTML;
      let seeds = question.querySelectorAll('deployedseed');
      if (seeds.length) {
        randSeed = parseInt(seeds[Math.floor(Math.random() * seeds.length)].textContent);
      }
      break;
    }
  }
  return { questionxml: setQuestion(thequestion), seed: randSeed };
}

function setQuestion(question) {
  return '<quiz>\n' + question + '\n</quiz>';
}

function createQuestionBlocks() {
  const questionBlocks = document.getElementsByClassName("que stack");
  let i = 0;

  for (const questionblock of questionBlocks) {
    i++;
    let questionPrefix = "q" + i.toString() + "_";
    var qfile = questionblock.dataset.qfile;
    var qname = questionblock.dataset.qname || "";
    questionblock.innerHTML =
      `
                  <div class="collapsiblecontent" id=${questionPrefix + "stack"}>
                      <div class="vstack gap-3 ms-3 col-lg-8">
                          <div id=${questionPrefix + "errors"}></div>
                          <div id=${questionPrefix + "stackapi_qtext"} class="col-lg-8" style="display: none">
                            <div id=${questionPrefix + "output"} class="formulation"></div>
                            <div id=${questionPrefix + "specificfeedback"}></div>
                            <br>
                            <span class="noninfo">
                              <input type="button" class="btn btn-primary" value="${stackstring["api_submit"]}"/>
                              <span id=${questionPrefix + "stackapi_spinner"} style="display:none" aria-label="Loading">&nbsp;&#9203;</span>
                            </span>
                            <span id=${questionPrefix + "stackapi_validity"} style="color:darkred"></span>
                          </div>
                          <div id=${questionPrefix + "stackapi_generalfeedback"} class="col-lg-8" style="display: none">
                            <h2>${stackstring['generalfeedback']}:</h2>
                            <div id=${questionPrefix + "generalfeedback"} class="feedback"></div>
                          </div>
                          <h2 id=${questionPrefix + "stackapi_score"} style="display: none">${stackstring['score']}: <span id=${questionPrefix + "score"}></span></h2>
                          <div id=${questionPrefix + "stackapi_summary"} class="col-lg-10" style="display: none">
                            <h2>${stackstring['api_response']}:</h2>
                            <div id=${questionPrefix + "response_summary"} class="feedback"></div>
                          </div>
                          <div id=${questionPrefix + "stackapi_correct"} class="col-lg-10" style="display: none">
                            <h2>${stackstring['api_correct']}:</h2>
                            <div id=${questionPrefix + "formatcorrectresponse"} class="feedback"></div>
                          </div>
                          <div id=${questionPrefix + "stackapi_questionnote"} class="col-lg-10" style="display: none">
                            <h2>${stackstring['api_questionnote']}:</h2>
                            <div id=${questionPrefix + "questionnote"} class="feedback"></div>
                          </div>
                      </div>
                      <div id=${questionPrefix + "newquestionbutton"}>
                        <input type="button" onclick="send('${qfile}', '${qname}', '${questionPrefix}')" class="btn btn-primary" value="Show new example question"/>
                        <span id=${questionPrefix + "stackapi_spinner"} style="display:none" aria-label="Loading">&nbsp;&#9203;</span>
                      </div>
                  </div>
                `;
  }
}

function addCollapsibles() {
  var collapsibles = document.querySelectorAll(".level2>h2, .stack>h2");
  for (let i = 0; i < collapsibles.length; i++) {
    collapsibles[i].addEventListener("click", () => collapseFunc(this));
  }
}

function collapseFunc(e) {
  e.classList.toggle("collapsed");
}

function stackSetup() {
  createQuestionBlocks();
  addCollapsibles();
}

function getPlotUrl(file) {
  return `${stack_api_url}/plots/${file}`;
}