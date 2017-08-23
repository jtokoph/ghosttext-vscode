var vscode = require('vscode');
var { Range, Position } = vscode;
var { workspace, window, commands } = vscode;
var http = require('http');
var ws = require('nodejs-websocket');
var tmp = require('tmp');

class OnMessage {
  constructor(webSocketConnection) {
    this.webSocketConnection = webSocketConnection;
    let that = this;
    this.onTextCallBack = text => that.onMessage(text);

    this.editor = null;
    this.document = null;
    this.webSocketConnection.on('text', this.onTextCallBack);
    this.webSocketConnection.on('close', this.doCleanup);
    this.remoteChangedText = null;
    this.editorTitle = null;
    this.cleanupCallback = null;
    this.disposables = [];

    this.closed = false;
  }

  doCleanup() {
    this.cleanupCallback && this.cleanupCallback();
    this.disposables.forEach((d) => d.dispose());
  }

  updateEditorText(text) {
    this.editor.edit((editBuilder) => {
      var lineCount = this.editor.document.lineCount;
      var lastLine = this.editor.document.lineAt(lineCount - 1);
      var endPos = lastLine.range.end;
      var range = new Range(new Position(0, 0), endPos);
      editBuilder.delete(range);
      editBuilder.insert(new Position(0,0), text);
    });
  }

  onMessage(text) {
    let request = JSON.parse(text);

    if (this.editor === null) {
      this.editorTitle = request.title;
      tmp.file((err, path, fd, cleanupCallback) => {
        this.cleanupCallback = cleanupCallback;

        workspace.openTextDocument(path)
        .then((textDocument) => {
          this.document = textDocument;
          window.showTextDocument(textDocument).then((editor) => {
            this.editor = editor;
            this.updateEditorText(request.text);

            this.disposables.push(workspace.onDidCloseTextDocument((doc) => {
              if(doc == this.document && doc.isClosed) {
                this.closed = true;
                this.webSocketConnection.close();
                this.doCleanup();
              }
            }));

            this.disposables.push(workspace.onDidChangeTextDocument((event) => {
              if(event.document == this.document) {
                let changedText = this.document.getText();
                if (changedText !== this.remoteChangedText) {
                  var change = {
                    title: this.editorTitle,
                    text:  changedText,
                    syntax: 'TODO',
                    selections: []
                  };
                  change = JSON.stringify(change);

                  // empty doc change event fires before close. Work around race.
                  return setTimeout(() => this.closed || this.webSocketConnection.sendText(change), 50);
                }
              }
            }));
          });
        });
      });
    } else {
      this.updateEditorText(request.text);
      return this.remoteChangedText = request.text;
    }
  }
}

var httpStatusServer = null;

var activate = (context) => {
  console.log('Activating GhostText');

  var disposable = commands.registerCommand('extension.enableGhostText', () => {
      window.showInformationMessage('Ghost text has been enabled!');
  });

  context.subscriptions.push(disposable);

  this.httpStatusServer = http.createServer(function(req, res) {
    let wsServer = ws.createServer((conn) => new OnMessage(conn));

    wsServer.on('listening', function() {
      let response = {
        ProtocolVersion: 1,
        WebSocketPort: wsServer.socket.address().port
      };
      response = JSON.stringify(response);
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(response);
    });

    return wsServer.listen(0);
  });

  return this.httpStatusServer.listen(4001);
};

var deactivate = () => {
  return this.httpStatusServer.close();
};

exports.httpStatusServer = httpStatusServer;
exports.activate = activate;
exports.deactivate = deactivate;
